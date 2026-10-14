"""JSON API: auth, profile, projects, assets, generation, assistant, misc."""
from __future__ import annotations

import json
import re
from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DbSession

from ..config import DATA_DIR, get_settings
from ..db import get_session, session_factory
from ..i18n import lang_pack, normalize_lang, t
from ..models import Asset, GenJob, Notification, Project, User, utcnow
from ..ratelimit import allow
from ..security import create_session, hash_password, new_token, resolve_session, revoke_session, sha256_hex, verify_password
from ..services import audit as audit_svc
from ..services import credits as credits_svc
from ..services import projects as projects_svc
from ..services import generation as gen_svc
from ..services.assistant import execute_actions, plan, REGISTRY
from ..services.emailer import send_email, smtp_configured
from .deps import COOKIE_NAME, check_csrf, client_ip, get_current_user, require_user

router = APIRouter(prefix="/api", dependencies=[Depends(check_csrf)])


def _err(lang: str, key: str, status: int = 400, **kw) -> JSONResponse:
    return JSONResponse({"ok": False, "error": t(lang, key, **kw)}, status_code=status)


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")


# ---------------------------------------------------------------------- i18n --

@router.get("/i18n/{lang}")
def get_i18n(lang: str):
    return {"lang": normalize_lang(lang), "pack": lang_pack(lang)}


@router.get("/i18n")
def get_i18n_meta():
    return {"langs": ["uz", "en", "ru"], "default": "uz", "tools": list(REGISTRY.keys())}


# ---------------------------------------------------------------------- auth --

class RegisterBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=255)
    password: str = Field(min_length=1, max_length=200)
    password2: str = Field(min_length=1, max_length=200)
    lang: str = "uz"


@router.post("/auth/register")
def register(body: RegisterBody, request: Request, db: DbSession = Depends(get_session)):
    ip = client_ip(request)
    if not allow("auth", ip):
        return _err("uz", "error.generic", 429)
    lang = normalize_lang(body.lang)
    if len(body.name.strip()) < 2:
        return _err(lang, "err.name_short")
    if not EMAIL_RE.match(body.email):
        return _err(lang, "err.email_invalid")
    if len(body.password) < 8:
        return _err(lang, "err.pass_short")
    if body.password != body.password2:
        return _err(lang, "err.pass_mismatch")
    email = body.email.strip().lower()
    if db.query(User).filter(User.email == email).first():
        return _err(lang, "err.email_taken", 409)
    settings = get_settings()
    user = User(full_name=body.name.strip()[:120], email=email, password_hash=hash_password(body.password), lang=lang)
    db.add(user)
    db.commit()
    credits_svc.grant(db, user, settings.welcome_credits, "welcome", ref_id="signup", notify_user=False)
    sess = create_session(db, user, source="web", ip=ip, user_agent=request.headers.get("user-agent", "")[:250])
    audit_svc.audit_log(db, "user.register", actor_id=user.id, actor_label=email, ip=ip)
    resp = JSONResponse({"ok": True, "user": user.to_public()})
    resp.set_cookie(COOKIE_NAME, sess.__dict__["raw_token"], httponly=True, samesite="lax", secure=settings.is_production, max_age=settings.session_days * 86400)
    return resp


class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/auth/login")
def login(body: LoginBody, request: Request, db: DbSession = Depends(get_session)):
    ip = client_ip(request)
    if not allow("auth", ip):
        return _err("uz", "error.generic", 429)
    email = body.email.strip().lower()
    user = db.query(User).filter(User.email == email).first()
    if not user or not verify_password(user.password_hash, body.password):
        audit_svc.audit_log(db, "auth.login_failed", actor_label=email, ip=ip)
        return _err("en", "err.creds", 401)
    if user.is_banned:
        return JSONResponse({"ok": False, "error": t(user.lang, "error.banned", reason=user.ban_reason or "")}, status_code=403)
    settings = get_settings()
    sess = create_session(db, user, source="web", ip=ip, user_agent=request.headers.get("user-agent", "")[:250])
    audit_svc.audit_log(db, "auth.login", actor_id=user.id, actor_label=email, ip=ip)
    resp = JSONResponse({"ok": True, "user": user.to_public()})
    resp.set_cookie(COOKIE_NAME, sess.__dict__["raw_token"], httponly=True, samesite="lax", secure=settings.is_production, max_age=settings.session_days * 86400)
    return resp


@router.post("/auth/logout")
def logout(request: Request, db: DbSession = Depends(get_session), user: User | None = Depends(get_current_user)):
    if user is not None and getattr(request.state, "session", None) is not None:
        revoke_session(db, request.state.session)
        audit_svc.audit_log(db, "auth.logout", actor_id=user.id, actor_label=user.email or f"tg:{user.telegram_id}", ip=client_ip(request))
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE_NAME)
    return resp


@router.post("/auth/forgot")
def forgot(body: dict, request: Request, db: DbSession = Depends(get_session)):
    ip = client_ip(request)
    if not allow("email", ip):
        return _err("en", "error.generic", 429)
    email = str(body.get("email", "")).strip().lower()
    user = db.query(User).filter(User.email == email).first()
    generic = {"ok": True, "message": "If the email exists, a reset link has been sent."}
    if not user:
        return generic
    from ..models import EmailToken

    raw = new_token(24)
    db.add(EmailToken(user_id=user.id, token_hash=sha256_hex(raw), kind="reset"))
    db.commit()
    settings = get_settings()
    link = f"{settings.public_url}/reset-password?token={raw}"
    result = send_email(db, email, "ZYVORA password reset", f"Reset your password:\n{link}\n\nIf you did not request this, ignore this email.", dev_link=link)
    audit_svc.audit_log(db, "auth.reset_requested", actor_id=user.id, actor_label=email, ip=ip)
    if result.delivered:
        return generic
    if settings.debug and result.dev_link:
        return {**generic, "dev_link": result.dev_link, "dev_note": "DEV: SMTP not configured"}
    return {**generic, "error": "email_not_configured" if not smtp_configured() else None}


class ResetBody(BaseModel):
    token: str
    password: str
    password2: str


@router.post("/auth/reset")
def reset_password(body: ResetBody, db: DbSession = Depends(get_session)):
    from ..models import EmailToken

    if len(body.password) < 8:
        return _err("en", "err.pass_short")
    if body.password != body.password2:
        return _err("en", "err.pass_mismatch")
    row = db.query(EmailToken).filter_by(token_hash=sha256_hex(body.token), kind="reset", used_at=None).first()
    if not row or row.expires_at < utcnow():
        return _err("en", "auth.verify.fail", 400)
    user = db.get(User, row.user_id)
    if not user:
        return _err("en", "error.generic")
    user.password_hash = hash_password(body.password)
    row.used_at = utcnow()
    from ..security import revoke_all_sessions

    revoke_all_sessions(db, user.id)
    db.commit()
    audit_svc.audit_log(db, "auth.reset_done", actor_id=user.id, actor_label=user.email or "")
    return {"ok": True}


# -------------------------------------------------------------------- me --

@router.get("/me")
def me(request: Request, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    settings = get_settings()
    project_count = db.query(Project).filter_by(owner_id=user.id, archived=False).count()
    asset_count = db.query(Asset).filter_by(owner_id=user.id).count()
    jobs = db.query(GenJob).filter_by(user_id=user.id).count()
    sess = getattr(request.state, "session", None)
    return {
        "ok": True,
        "user": user.to_public(),
        "auth_source": getattr(request.state, "auth_source", None),
        "csrf": sess.csrf_token if sess is not None else None,
        "is_admin": user.role in ("admin", "moderator"),
        "counts": {"projects": project_count, "assets": asset_count, "jobs": jobs},
        "pricing": gen_svc.get_pricing(db),
        "limits": {
            "gen_daily": settings.gen_daily_limit,
            "upload_max_mb": settings.upload_max_mb,
            "project_max_kb": settings.project_max_kb,
        },
        "email_delivery": smtp_configured(),
        "ledger": [
            {"delta": r.delta, "balance": r.balance_after, "reason": r.reason, "ref": r.ref_id, "at": r.created_at.isoformat()}
            for r in credits_svc.history(db, user.id, 20)
        ],
    }


class MePatch(BaseModel):
    full_name: str | None = None
    lang: str | None = None
    theme: str | None = None


@router.patch("/me")
def patch_me(body: MePatch, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    if body.full_name is not None:
        name = body.full_name.strip()
        if not (2 <= len(name) <= 120):
            return _err(user.lang, "err.name_short")
        user.full_name = name
    if body.lang is not None:
        user.lang = normalize_lang(body.lang)
    if body.theme is not None:
        if body.theme not in ("dark", "light"):
            return _err(user.lang, "error.generic")
        user.theme = body.theme
    db.commit()
    return {"ok": True, "user": user.to_public()}


class PasswordBody(BaseModel):
    old_password: str
    new_password: str


@router.post("/me/password")
def change_password(body: PasswordBody, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    if not verify_password(user.password_hash, body.old_password):
        return _err(user.lang, "err.pass_wrong", 403)
    if len(body.new_password) < 8:
        return _err(user.lang, "err.pass_short")
    user.password_hash = hash_password(body.new_password)
    db.commit()
    audit_svc.audit_log(db, "auth.password_changed", actor_id=user.id, actor_label=user.email or f"tg:{user.telegram_id}")
    return {"ok": True}


@router.post("/me/delete")
def delete_account(body: dict, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    password = str(body.get("password", ""))
    if user.password_hash and not verify_password(user.password_hash, password):
        return _err(user.lang, "err.pass_wrong", 403)
    # anonymize: delete projects/assets/uploads, detach telegram, revoke sessions
    from ..models import AuthSession

    for project in db.query(Project).filter_by(owner_id=user.id).all():
        projects_svc.soft_delete(db, project)
    for asset in db.query(Asset).filter_by(owner_id=user.id).all():
        try:
            p = DATA_DIR / asset.path
            if p.exists() and p.is_file():
                p.unlink()
        except Exception:  # noqa: BLE001
            pass
        db.delete(asset)
    db.query(AuthSession).filter(AuthSession.user_id == user.id).delete()
    user.telegram_id = None
    user.username = None
    old_email = user.email
    user.email = None
    user.password_hash = None
    user.is_banned = True
    user.ban_reason = "account deleted"
    db.commit()
    audit_svc.audit_log(db, "user.deleted", actor_id=user.id, actor_label=old_email or f"tg:{user.telegram_id}", detail={"anonymized": True})
    resp = JSONResponse({"ok": True})
    resp.delete_cookie(COOKIE_NAME)
    return resp


@router.get("/notifications")
def notifications(user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    rows = db.query(Notification).filter_by(user_id=user.id).order_by(Notification.id.desc()).limit(30).all()
    return {"ok": True, "items": [{"id": n.id, "kind": n.kind, "text": n.text, "read": n.read_at is not None, "at": n.created_at.isoformat()} for n in rows]}


@router.post("/notifications/read")
def notifications_read(user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    db.query(Notification).filter_by(user_id=user.id, read_at=None).update({"read_at": utcnow()})
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- projects --

class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    kind: str = "2d"


@router.get("/projects")
def list_projects(kind: str | None = None, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    rows = projects_svc.list_for(db, user.id, kind)
    return {
        "ok": True,
        "items": [
            {"id": p.id, "name": p.name, "kind": p.kind, "version": p.version, "updated_at": p.updated_at.isoformat(), "created_at": p.created_at.isoformat()}
            for p in rows
        ],
    }


@router.post("/projects")
def create_project(body: ProjectCreate, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    try:
        p = projects_svc.create(db, user.id, body.name, body.kind)
    except projects_svc.ProjectError:
        return _err(user.lang, "error.generic")
    audit_svc.audit_log(db, "project.create", actor_id=user.id, target=f"project:{p.id}", detail={"kind": p.kind, "name": p.name}, commit=False)
    db.commit()
    return {"ok": True, "project": {"id": p.id, "name": p.name, "kind": p.kind}}


@router.get("/projects/{pid}")
def get_project(pid: int, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    p = projects_svc.get_owned(db, pid, user.id)
    if not p:
        raise HTTPException(404, "project not found")
    return {
        "ok": True,
        "project": {
            "id": p.id, "name": p.name, "kind": p.kind, "version": p.version, "data": p.data,
            "updated_at": p.updated_at.isoformat(),
        },
    }


class ProjectData(BaseModel):
    data: dict
    snapshot: bool = False


@router.put("/projects/{pid}/data")
def save_project(pid: int, body: ProjectData, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    p = projects_svc.get_owned(db, pid, user.id)
    if not p:
        raise HTTPException(404, "project not found")
    try:
        projects_svc.save(db, p, body.data, snapshot=body.snapshot)
    except projects_svc.ProjectError as exc:
        return _err(user.lang, "error.generic", 413)
    return {"ok": True, "version": p.version, "updated_at": p.updated_at.isoformat()}


@router.patch("/projects/{pid}")
def rename_project(pid: int, body: dict, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    p = projects_svc.get_owned(db, pid, user.id)
    if not p:
        raise HTTPException(404, "project not found")
    try:
        projects_svc.rename(db, p, str(body.get("name", "")))
    except projects_svc.ProjectError:
        return _err(user.lang, "error.generic")
    return {"ok": True, "name": p.name}


@router.delete("/projects/{pid}")
def delete_project(pid: int, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    p = projects_svc.get_owned(db, pid, user.id)
    if not p:
        raise HTTPException(404, "project not found")
    projects_svc.soft_delete(db, p)
    audit_svc.audit_log(db, "project.delete", actor_id=user.id, target=f"project:{p.id}", detail={"name": p.name}, commit=False)
    db.commit()
    return {"ok": True}


@router.get("/projects/{pid}/versions")
def project_versions(pid: int, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    p = projects_svc.get_owned(db, pid, user.id)
    if not p:
        raise HTTPException(404, "project not found")
    return {
        "ok": True,
        "items": [{"version": v.version, "created_at": v.created_at.isoformat()} for v in p.versions],
    }


@router.post("/projects/{pid}/restore/{version}")
def restore_version(pid: int, version: int, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    p = projects_svc.get_owned(db, pid, user.id)
    if not p:
        raise HTTPException(404, "project not found")
    ver = db.query(type(p.versions[0]) if p.versions else None)
    from ..models import ProjectVersion

    row = db.query(ProjectVersion).filter_by(project_id=p.id, version=version).first()
    if not row:
        return _err(user.lang, "error.generic", 404)
    projects_svc.save(db, p, row.data, snapshot=True)
    audit_svc.audit_log(db, "project.restore", actor_id=user.id, target=f"project:{p.id}", detail={"version": version})
    return {"ok": True, "version": p.version}


# ------------------------------------------------------------------- assets --

ALLOWED_MIME = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
MAGIC = {b"\x89PNG": "png", b"\xff\xd8\xff": "jpg", b"RIFF": "webp"}


def _detect_ext(data: bytes) -> str | None:
    for magic, ext in MAGIC.items():
        if data.startswith(magic):
            if ext == "webp" and data[8:12] != b"WEBP":
                continue
            return ext
    return None


@router.get("/assets")
def list_assets(user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    rows = db.query(Asset).filter_by(owner_id=user.id).order_by(Asset.id.desc()).limit(100).all()
    return {"ok": True, "items": [
        {"id": a.id, "name": a.name, "kind": a.kind, "mime": a.mime, "size": a.size, "created_at": a.created_at.isoformat()}
        for a in rows
    ]}


@router.post("/assets")
async def upload_asset(request: Request, file: UploadFile = File(...), user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    settings = get_settings()
    data = await file.read()
    if len(data) > settings.upload_max_mb * 1024 * 1024:
        return _err(user.lang, "up.too_big", 413, mb=settings.upload_max_mb)
    ext = _detect_ext(data)
    if ext is None:
        return _err(user.lang, "up.bad_type", 415)
    uploads = DATA_DIR / "uploads" / str(user.id)
    uploads.mkdir(parents=True, exist_ok=True)
    fname = f"{new_token(8)}.{ext}"
    (uploads / fname).write_bytes(data)
    asset = Asset(
        owner_id=user.id,
        name=(file.filename or fname)[:200],
        kind="image",
        mime=f"image/{ext}",
        size=len(data),
        path=str((uploads / fname).relative_to(DATA_DIR)),
        meta={},
    )
    db.add(asset)
    db.commit()
    audit_svc.audit_log(db, "asset.upload", actor_id=user.id, target=f"asset:{asset.id}", detail={"size": len(data)}, commit=False)
    db.commit()
    return {"ok": True, "asset": {"id": asset.id, "name": asset.name, "size": asset.size}}


@router.get("/assets/{aid}/file")
def asset_file(aid: int, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    a = db.query(Asset).filter_by(id=aid, owner_id=user.id).first()
    if not a:
        raise HTTPException(404, "not found")
    p = DATA_DIR / a.path
    if not p.exists():
        raise HTTPException(404, "file missing")
    return FileResponse(p, media_type=a.mime or "application/octet-stream", filename=a.name)


@router.delete("/assets/{aid}")
def delete_asset(aid: int, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    a = db.query(Asset).filter_by(id=aid, owner_id=user.id).first()
    if not a:
        raise HTTPException(404, "not found")
    try:
        p = DATA_DIR / a.path
        if p.exists():
            p.unlink()
    except Exception:  # noqa: BLE001
        pass
    db.delete(a)
    db.commit()
    return {"ok": True}


# --------------------------------------------------------------- generation --

@router.get("/gen/pricing")
def gen_pricing(user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    from ..services.providers import provider_status_list

    return {
        "ok": True,
        "pricing": gen_svc.get_pricing(db),
        "providers": provider_status_list(),
        "credits": user.credits,
    }


class GenBody(BaseModel):
    kind: str
    prompt: str = ""
    params: dict = {}
    confirm_cost: bool = False
    idempotency_key: str | None = None


@router.post("/gen")
def submit_gen(body: GenBody, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    if not allow("gen", str(user.id)):
        return _err(user.lang, "ai.quota", 429, limit=999)
    cost = gen_svc.estimate_cost(db, body.kind)
    if cost > 0 and not body.confirm_cost:
        return JSONResponse({"ok": False, "needs_confirm": True, "cost": cost, "credits": user.credits, "error": t(user.lang, "ai.confirm_cost", cost=cost)}, status_code=402)
    job, error, _ = gen_svc.create_job(db, user, body.kind, body.prompt, body.params, body.idempotency_key)
    if error:
        status = 402 if "credits" in error else 429 if "limit" in error else 400
        return JSONResponse({"ok": False, "error": error}, status_code=status)
    return {"ok": True, "job": {"id": job.id, "kind": job.kind, "status": job.status, "cost": job.cost_credits, "provider": job.provider}}


@router.get("/gen")
def list_jobs(limit: int = 30, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    rows = db.query(GenJob).filter_by(user_id=user.id).order_by(GenJob.id.desc()).limit(min(limit, 100)).all()
    return {"ok": True, "items": [
        {"id": j.id, "kind": j.kind, "status": j.status, "progress": j.progress, "provider": j.provider,
         "prompt": j.prompt[:120], "error": j.error, "result_meta": j.result_meta, "cost": j.cost_credits,
         "created_at": j.created_at.isoformat()}
        for j in rows
    ]}


@router.get("/gen/{jid}")
def get_job(jid: int, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    j = db.query(GenJob).filter_by(id=jid, user_id=user.id).first()
    if not j:
        raise HTTPException(404, "not found")
    return {"ok": True, "job": {"id": j.id, "kind": j.kind, "status": j.status, "progress": j.progress, "provider": j.provider, "error": j.error, "result_meta": j.result_meta}}


# --------------------------------------------------------------- assistant --

class AssistantBody(BaseModel):
    project_id: int
    message: str = Field(min_length=1, max_length=2000)
    mode: str = "mentor"


@router.post("/assistant")
def assistant(body: AssistantBody, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    if not allow("assistant", str(user.id)):
        return _err(user.lang, "error.generic", 429)
    project = projects_svc.get_owned(db, body.project_id, user.id)
    if not project:
        raise HTTPException(404, "project not found")
    if body.mode not in ("mentor", "copilot", "agent"):
        return _err(user.lang, "error.generic")
    outcome = plan(db, project, body.message, body.mode)
    executed = None
    if body.mode == "agent" and outcome["actions"]:
        executed = execute_actions(db, project, outcome["actions"])
        audit_svc.audit_log(db, "assistant.agent_run", actor_id=user.id, target=f"project:{project.id}", detail={"actions": len(outcome["actions"])}, commit=False)
        db.commit()
    return {"ok": True, **outcome, "executed": executed, "project_updated": body.mode == "agent" and bool(outcome["actions"])}


class ExecuteBody(BaseModel):
    project_id: int
    actions: list[dict]


@router.post("/assistant/execute")
def assistant_execute(body: ExecuteBody, user: User = Depends(require_user), db: DbSession = Depends(get_session)):
    project = projects_svc.get_owned(db, body.project_id, user.id)
    if not project:
        raise HTTPException(404, "project not found")
    outcome = execute_actions(db, project, body.actions)
    audit_svc.audit_log(db, "assistant.execute", actor_id=user.id, target=f"project:{project.id}", detail={"actions": len(body.actions)}, commit=False)
    db.commit()
    return {"ok": True, **outcome}
