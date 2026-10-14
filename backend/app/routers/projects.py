import json

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.audit import audit
from app.config import get_settings
from app.db import get_db
from app.deps import get_current_user
from app.models import Project, ProjectVersion, User, utcnow
from app.schemas import (
    DocumentSaveIn,
    DocumentSaveOut,
    ProjectCreateIn,
    ProjectDetailOut,
    ProjectOut,
    ProjectPatchIn,
    VersionOut,
)

router = APIRouter(prefix="/api/projects", tags=["projects"])

EMPTY_DOCUMENT_VERSION = 1


def empty_document(name: str) -> dict:
    return {
        "schemaVersion": EMPTY_DOCUMENT_VERSION,
        "name": name,
        "objects": {},
        "objectOrder": [],
        "characters": {},
        "animations": {},
        "cameras": {},
        "shots": {},
        "layers": [],
        "audioTracks": [],
        "story": {"title": "", "scenes": []},
    }


def _get_owned(db: Session, project_id: str, user: User) -> Project:
    """Ownership is enforced here on the backend. Other users' projects return 404."""
    project = db.get(Project, project_id)
    if project is None or project.deleted_at is not None or project.owner_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Project not found")
    return project


def _out(p: Project) -> ProjectOut:
    return ProjectOut(id=p.id, name=p.name, folder=p.folder, version=p.version,
                      created_at=p.created_at, updated_at=p.updated_at)


@router.get("", response_model=list[ProjectOut])
def list_projects(q: str | None = None, folder: str | None = None,
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    stmt = select(Project).where(Project.owner_id == user.id, Project.deleted_at.is_(None))
    if q:
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(Project.name.ilike(like), Project.folder.ilike(like)))
    if folder:
        stmt = stmt.where(Project.folder == folder)
    rows = db.scalars(stmt.order_by(Project.updated_at.desc())).all()
    return [_out(p) for p in rows]


@router.get("/folders", response_model=list[str])
def list_folders(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(Project.folder).where(Project.owner_id == user.id,
                                                   Project.deleted_at.is_(None)).distinct()).all()
    return sorted(set(rows) | {"Default"})


@router.post("", response_model=ProjectDetailOut, status_code=201)
def create_project(body: ProjectCreateIn, request: Request, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    p = Project(owner_id=user.id, name=body.name.strip(), folder=body.folder.strip(),
                document=empty_document(body.name.strip()), version=1)
    db.add(p)
    db.flush()
    db.add(ProjectVersion(project_id=p.id, version=1, document=p.document, created_by=user.id))
    audit(db, "project.create", actor_id=user.id, target=p.id, request=request)
    db.commit()
    return ProjectDetailOut(**_out(p).model_dump(), document=p.document)


@router.get("/{project_id}", response_model=ProjectDetailOut)
def get_project(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _get_owned(db, project_id, user)
    return ProjectDetailOut(**_out(p).model_dump(), document=p.document)


@router.patch("/{project_id}", response_model=ProjectOut)
def patch_project(project_id: str, body: ProjectPatchIn, request: Request,
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _get_owned(db, project_id, user)
    if body.name is not None:
        p.name = body.name.strip()
    if body.folder is not None:
        p.folder = body.folder.strip()
    audit(db, "project.update", actor_id=user.id, target=p.id, request=request)
    db.commit()
    return _out(p)


@router.post("/{project_id}/duplicate", response_model=ProjectDetailOut, status_code=201)
def duplicate_project(project_id: str, request: Request, user: User = Depends(get_current_user),
                      db: Session = Depends(get_db)):
    src = _get_owned(db, project_id, user)
    name = f"{src.name} (copy)"[:200]
    doc = json.loads(json.dumps(src.document))
    doc["name"] = name
    p = Project(owner_id=user.id, name=name, folder=src.folder, document=doc, version=1)
    db.add(p)
    db.flush()
    db.add(ProjectVersion(project_id=p.id, version=1, document=doc, created_by=user.id))
    audit(db, "project.duplicate", actor_id=user.id, target=p.id, detail={"source": src.id}, request=request)
    db.commit()
    return ProjectDetailOut(**_out(p).model_dump(), document=p.document)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str, request: Request, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    p = _get_owned(db, project_id, user)
    p.deleted_at = utcnow()
    audit(db, "project.delete", actor_id=user.id, target=p.id, request=request)
    db.commit()
    return Response(status_code=204)


@router.put("/{project_id}/document", response_model=DocumentSaveOut)
def save_document(project_id: str, body: DocumentSaveIn, request: Request,
                  user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    """Autosave target. Optimistic concurrency via base_version; every save creates a version."""
    p = _get_owned(db, project_id, user)
    settings = get_settings()
    size_kb = len(json.dumps(body.document).encode("utf-8")) / 1024
    if size_kb > settings.max_document_kb:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                            f"Project document exceeds {settings.max_document_kb} KB")
    if body.base_version != p.version:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            {"message": "Version conflict", "server_version": p.version})
    p.document = body.document
    p.version = p.version + 1
    db.add(ProjectVersion(project_id=p.id, version=p.version, document=body.document, created_by=user.id))
    db.flush()
    # Keep only the most recent N versions.
    old = db.scalars(select(ProjectVersion.id).where(ProjectVersion.project_id == p.id)
                     .order_by(ProjectVersion.version.desc()).offset(settings.max_versions_kept)).all()
    if old:
        for vid in old:
            db.delete(db.get(ProjectVersion, vid))
    db.commit()
    return DocumentSaveOut(version=p.version, updated_at=p.updated_at)


@router.get("/{project_id}/versions", response_model=list[VersionOut])
def list_versions(project_id: str, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _get_owned(db, project_id, user)
    rows = db.scalars(select(ProjectVersion).where(ProjectVersion.project_id == p.id)
                      .order_by(ProjectVersion.version.desc())).all()
    return [VersionOut(version=v.version, created_at=v.created_at, created_by=v.created_by) for v in rows]


@router.post("/{project_id}/versions/{version}/restore", response_model=DocumentSaveOut)
def restore_version(project_id: str, version: int, request: Request,
                    user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = _get_owned(db, project_id, user)
    v = db.scalar(select(ProjectVersion).where(ProjectVersion.project_id == p.id,
                                               ProjectVersion.version == version))
    if v is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Version not found")
    p.document = json.loads(json.dumps(v.document))
    p.version = p.version + 1
    db.add(ProjectVersion(project_id=p.id, version=p.version, document=p.document, created_by=user.id))
    audit(db, "project.restore_version", actor_id=user.id, target=p.id,
          detail={"from_version": version}, request=request)
    db.commit()
    return DocumentSaveOut(version=p.version, updated_at=p.updated_at)
