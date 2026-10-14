"""Project service: CRUD + validation + version snapshots."""
from __future__ import annotations

import json

from sqlalchemy.orm import Session as DbSession

from ..models import Project, ProjectVersion, utcnow

MAX_VERSIONS_KEPT = 20
PROJECT_KINDS = ("2d", "3d", "animation", "character")


class ProjectError(Exception):
    pass


def create(db: DbSession, owner_id: int, name: str, kind: str, data: dict | None = None) -> Project:
    name = (name or "").strip()
    if not (1 <= len(name) <= 160):
        raise ProjectError("invalid name")
    if kind not in PROJECT_KINDS:
        raise ProjectError("invalid kind")
    payload = data or default_data(kind)
    _validate_size(payload)
    project = Project(owner_id=owner_id, name=name, kind=kind, data=payload, version=1)
    db.add(project)
    db.commit()
    db.refresh(project)
    db.add(ProjectVersion(project_id=project.id, version=1, data=payload))
    db.commit()
    return project


def default_data(kind: str) -> dict:
    if kind == "2d":
        return {"width": 1280, "height": 720, "layers": [{"name": "Layer 1", "visible": True, "image": None}], "active_layer": 0}
    if kind == "3d":
        return {"objects": [], "environment": {"background": "#0b1530", "grid": True}}
    if kind == "animation":
        return {"width": 960, "height": 540, "fps": 8, "frames": [{"layers": [{"name": "Layer 1", "visible": True, "image": None}]}], "active_frame": 0}
    if kind == "character":
        return {"description": "", "notes": "", "palette": [], "refs": []}
    return {}


def _validate_size(data: dict) -> None:
    from ..config import get_settings

    raw = json.dumps(data, ensure_ascii=False)
    limit = get_settings().project_max_kb * 1024
    if len(raw.encode("utf-8")) > limit:
        raise ProjectError("project too large")


def get_owned(db: DbSession, project_id: int, owner_id: int) -> Project | None:
    return db.query(Project).filter_by(id=project_id, owner_id=owner_id, archived=False).first()


def save(db: DbSession, project: Project, data: dict, *, snapshot: bool = False) -> Project:
    _validate_size(data)
    if not isinstance(data, dict):
        raise ProjectError("data must be an object")
    project.data = data
    project.updated_at = utcnow()
    if snapshot:
        project.version += 1
        db.add(ProjectVersion(project_id=project.id, version=project.version, data=data))
        # retention: keep only the last MAX_VERSIONS_KEPT
        versions = (
            db.query(ProjectVersion)
            .filter_by(project_id=project.id)
            .order_by(ProjectVersion.version.desc())
            .all()
        )
        for old in versions[MAX_VERSIONS_KEPT:]:
            db.delete(old)
    db.commit()
    return project


def rename(db: DbSession, project: Project, name: str) -> Project:
    name = (name or "").strip()
    if not (1 <= len(name) <= 160):
        raise ProjectError("invalid name")
    project.name = name
    project.updated_at = utcnow()
    db.commit()
    return project


def list_for(db: DbSession, owner_id: int, kind: str | None = None, limit: int = 200) -> list[Project]:
    q = db.query(Project).filter_by(owner_id=owner_id, archived=False)
    if kind:
        q = q.filter_by(kind=kind)
    return q.order_by(Project.updated_at.desc()).limit(limit).all()


def soft_delete(db: DbSession, project: Project) -> None:
    project.archived = True
    project.updated_at = utcnow()
    db.commit()
