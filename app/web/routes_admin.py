"""Admin API. Every endpoint enforces server-side role checks; every mutation is audited."""
from __future__ import annotations

import time
from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import String, func
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..db import active_db_label, db_ok, get_session
from ..i18n import t
from ..models import (
    Asset,
    AuditLog,
    Broadcast,
    CreditLedger,
    GenJob,
    Project,
    ProviderSetting,
    UsageRecord,
    User,
    utcnow,
)
from ..ratelimit import allow
from ..services import audit as audit_svc
from ..services import credits as credits_svc
from ..services import generation as gen_svc
from ..services.providers import get_adapter, provider_status_list
from ..bot.runner import bot_state
from .deps import client_ip, require_role

router = APIRouter(prefix="/api/admin")

viewer = require_role("admin", "moderator")
admin = require_role("admin")

START_TIME = time.time()
gen_worker_state: dict = {"last_error": None}


@router.get("/overview")
def overview(db: DbSession = Depends(get_session), user: User = Depends(viewer)):
    """Real metrics only — anything not measurable is reported as null/unavailable."""
    day7 = utcnow() - timedelta(days=7)
    total_users = db.query(func.count(User.id)).scalar() or 0
    new_users = db.query(func.count(User.id)).filter(User.created_at >= day7).scalar() or 0
    active_users = db.query(func.count(User.id)).filter(User.last_seen_at >= day7).scalar() or 0
    projects = db.query(func.count(Project.id)).filter(Project.archived == False).scalar() or 0  # noqa: E712
    assets = db.query(func.count(Asset.id)).scalar() or 0
    jobs_total = db.query(func.count(GenJob.id)).scalar() or 0
    jobs_ok = db.query(func.count(GenJob.id)).filter(GenJob.status == "completed").scalar() or 0
    jobs_failed = db.query(func.count(GenJob.id)).filter(GenJob.status == "failed").scalar() or 0
    jobs_active = db.query(func.count(GenJob.id)).filter(GenJob.status.in_(("queued", "running"))).scalar() or 0
    credits_issued = db.query(func.coalesce(func.sum(CreditLedger.delta), 0)).filter(CreditLedger.delta > 0).scalar() or 0
    usage = (
        db.query(UsageRecord.provider, func.count(UsageRecord.id), func.coalesce(func.sum(UsageRecord.credits_used), 0))
        .group_by(UsageRecord.provider)
        .all()
    )
    recent_events = db.query(AuditLog).order_by(AuditLog.id.desc()).limit(8).all()
    return {
        "ok": True,
        "users": {"total": total_users, "new_7d": new_users, "active_7d": active_users},
        "content": {"projects": projects, "assets": assets},
        "jobs": {"total": jobs_total, "completed": jobs_ok, "failed": jobs_failed, "active": jobs_active},
        "credits_issued": credits_issued,
        "revenue": {"available": False, "reason": "payment provider not configured"},
        "provider_usage": [{"provider": p or "-", "jobs": c, "credits_used": cr} for (p, c, cr) in usage],
        "recent_events": [
            {"id": e.id, "action": e.action, "actor": e.actor_label, "target": e.target, "at": e.created_at.isoformat()}
            for e in recent_events
        ],
    }


@router.get("/users")
def users_list(q: str = "", page: int = 1, db: DbSession = Depends(get_session), user: User = Depends(viewer)):
    page = max(1, page)
    per = 25
    query = db.query(User)
    if q:
        like = f"%{q.strip().lower()}%"
        query = query.filter(
            (func.lower(User.email).like(like))
            | (func.lower(User.full_name).like(like))
            | (func.lower(func.coalesce(User.username, "")).like(like))
            | (func.cast(User.telegram_id, String).like(like))
        )
    total = query.count()
    rows = query.order_by(User.id.desc()).offset((page - 1) * per).limit(per).all()
    return {
        "ok": True,
        "total": total,
        "page": page,
        "items": [
            {
                **u.to_public(),
                "projects": db.query(func.count(Project.id)).filter(Project.owner_id == u.id, Project.archived == False).scalar() or 0,  # noqa: E712
            }
            for u in rows
        ],
    }


def _get_target_user(db: DbSession, uid: int) -> User:
    u = db.get(User, uid)
    if not u:
        raise HTTPException(404, "user not found")
    return u


@router.post("/users/{uid}/ban")
def ban_user(uid: int, body: dict, request: Request, db: DbSession = Depends(get_session), admin_user: User = Depends(admin)):
    target = _get_target_user(db, uid)
    if target.id == admin_user.id:
        raise HTTPException(400, "cannot ban yourself")
    if target.role == "admin":
        raise HTTPException(400, "cannot ban another admin directly")
    target.is_banned = True
    target.ban_reason = str(body.get("reason", ""))[:250]
    from ..security import revoke_all_sessions

    revoke_all_sessions(db, target.id)
    db.commit()
    audit_svc.audit_log(db, "admin.ban", actor_id=admin_user.id, actor_label=admin_user.email or f"tg:{admin_user.telegram_id}", target=f"user:{target.id}", detail={"reason": target.ban_reason}, ip=client_ip(request))
    return {"ok": True}


@router.post("/users/{uid}/unban")
def unban_user(uid: int, request: Request, db: DbSession = Depends(get_session), admin_user: User = Depends(admin)):
    target = _get_target_user(db, uid)
    target.is_banned = False
    target.ban_reason = None
    db.commit()
    audit_svc.audit_log(db, "admin.unban", actor_id=admin_user.id, actor_label=admin_user.email or f"tg:{admin_user.telegram_id}", target=f"user:{target.id}", ip=client_ip(request))
    return {"ok": True}


@router.post("/users/{uid}/role")
def set_role(uid: int, body: dict, request: Request, db: DbSession = Depends(get_session), admin_user: User = Depends(admin)):
    role = str(body.get("role", ""))
    if role not in ("user", "moderator", "admin"):
        raise HTTPException(400, "invalid role")
    target = _get_target_user(db, uid)
    if target.id == admin_user.id and role != "admin":
        raise HTTPException(400, "cannot demote yourself")
    if target.telegram_id and target.telegram_id in get_settings().admin_ids and role != "admin":
        raise HTTPException(400, "user is protected by ZYVORA_ADMIN_IDS")
    old = target.role
    target.role = role
    db.commit()
    audit_svc.audit_log(db, "admin.role_change", actor_id=admin_user.id, actor_label=admin_user.email or f"tg:{admin_user.telegram_id}", target=f"user:{target.id}", detail={"old": old, "new": role}, ip=client_ip(request))
    return {"ok": True}


@router.post("/users/{uid}/credits")
def grant_credits(uid: int, body: dict, request: Request, db: DbSession = Depends(get_session), admin_user: User = Depends(admin)):
    try:
        amount = int(body.get("amount", 0))
    except (TypeError, ValueError):
        raise HTTPException(400, "invalid amount")
    if not (0 < amount <= 1_000_000):
        raise HTTPException(400, "invalid amount")
    target = _get_target_user(db, uid)
    credits_svc.grant(db, target, amount, "admin_grant", ref_id=f"by:{admin_user.id}")
    audit_svc.audit_log(db, "admin.grant_credits", actor_id=admin_user.id, actor_label=admin_user.email or f"tg:{admin_user.telegram_id}", target=f"user:{target.id}", detail={"amount": amount}, ip=client_ip(request))
    return {"ok": True, "credits": target.credits}


@router.post("/users/{uid}/revoke-sessions")
def revoke_sessions(uid: int, request: Request, db: DbSession = Depends(get_session), admin_user: User = Depends(admin)):
    target = _get_target_user(db, uid)
    from ..security import revoke_all_sessions

    n = revoke_all_sessions(db, target.id)
    audit_svc.audit_log(db, "admin.revoke_sessions", actor_id=admin_user.id, actor_label=admin_user.email or f"tg:{admin_user.telegram_id}", target=f"user:{target.id}", detail={"count": n}, ip=client_ip(request))
    return {"ok": True, "revoked": n}


@router.get("/jobs")
def jobs_list(status: str | None = None, limit: int = 50, db: DbSession = Depends(get_session), user: User = Depends(viewer)):
    q = db.query(GenJob)
    if status in ("queued", "running", "completed", "failed", "canceled"):
        q = q.filter(GenJob.status == status)
    rows = q.order_by(GenJob.id.desc()).limit(min(limit, 200)).all()
    owner_map = {u.id: u for u in db.query(User).filter(User.id.in_([j.user_id for j in rows])).all()} if rows else {}
    return {"ok": True, "items": [
        {
            "id": j.id, "kind": j.kind, "status": j.status, "provider": j.provider, "progress": j.progress,
            "prompt": j.prompt[:140], "error": (j.error or "")[:300], "cost": j.cost_credits,
            "user": (owner_map[j.user_id].email or f"tg:{owner_map[j.user_id].telegram_id}") if j.user_id in owner_map else str(j.user_id),
            "created_at": j.created_at.isoformat(),
        }
        for j in rows
    ]}


@router.post("/jobs/{jid}/retry")
def retry_job(jid: int, request: Request, db: DbSession = Depends(get_session), admin_user: User = Depends(admin)):
    job = db.get(GenJob, jid)
    if not job:
        raise HTTPException(404, "job not found")
    ok, error = gen_svc.retry_job(db, job)
    if not ok:
        raise HTTPException(400, error or "cannot retry")
    audit_svc.audit_log(db, "admin.job_retry", actor_id=admin_user.id, actor_label=admin_user.email or f"tg:{admin_user.telegram_id}", target=f"job:{job.id}", ip=client_ip(request))
    return {"ok": True}


@router.get("/providers")
def providers(db: DbSession = Depends(get_session), user: User = Depends(viewer)):
    rows = {p.name: p for p in db.query(ProviderSetting).all()}
    out = []
    for info in provider_status_list():
        row = rows.get(info["name"])
        out.append({
            **info,
            "enabled": row.enabled if row else True,
            "last_error": row.last_error if row else None,
            "last_checked_at": row.last_checked_at.isoformat() if row and row.last_checked_at else None,
        })
    return {"ok": True, "items": out, "note": "API keys are set via environment variables and are never displayed."}


@router.post("/providers/{name}/toggle")
def provider_toggle(name: str, request: Request, db: DbSession = Depends(get_session), admin_user: User = Depends(admin)):
    adapter = get_adapter(name)
    if adapter is None:
        raise HTTPException(404, "unknown provider")
    row = db.get(ProviderSetting, name)
    current = bool(row.enabled) if row is not None and row.enabled is not None else True
    if row is None:
        row = ProviderSetting(name=name)
        db.add(row)
    row.enabled = not current
    db.commit()
    audit_svc.audit_log(db, "admin.provider_toggle", actor_id=admin_user.id, actor_label=admin_user.email or f"tg:{admin_user.telegram_id}", target=f"provider:{name}", detail={"enabled": row.enabled}, ip=client_ip(request))
    return {"ok": True, "enabled": row.enabled}


@router.post("/providers/{name}/test")
def provider_test(name: str, request: Request, db: DbSession = Depends(get_session), admin_user: User = Depends(admin)):
    adapter = get_adapter(name)
    if adapter is None:
        raise HTTPException(404, "unknown provider")
    ok, msg = adapter.test_connection()
    row = db.get(ProviderSetting, name)
    if row is None:
        row = ProviderSetting(name=name)
        db.add(row)
    row.last_checked_at = utcnow()
    row.last_error = None if ok else msg
    db.commit()
    audit_svc.audit_log(db, "admin.provider_test", actor_id=admin_user.id, actor_label=admin_user.email or f"tg:{admin_user.telegram_id}", target=f"provider:{name}", detail={"ok": ok}, ip=client_ip(request))
    return {"ok": ok, "message": msg}


@router.get("/audit")
def audit_list(q: str | None = None, limit: int = 100, db: DbSession = Depends(get_session), user: User = Depends(viewer)):
    qy = db.query(AuditLog)
    if q:
        qy = qy.filter(AuditLog.action.like(f"%{q}%"))
    rows = qy.order_by(AuditLog.id.desc()).limit(min(limit, 300)).all()
    return {"ok": True, "items": [
        {"id": e.id, "action": e.action, "actor": e.actor_label, "target": e.target, "detail": e.detail, "ip": e.ip, "at": e.created_at.isoformat()}
        for e in rows
    ]}


class BroadcastIn(BaseModel):
    text: str
    lang: str | None = None


@router.post("/broadcast")
def broadcast(body: BroadcastIn, request: Request, db: DbSession = Depends(get_session), admin_user: User = Depends(admin)):
    from ..bot.runner import broadcast_message

    text = body.text.strip()
    if not (1 <= len(text) <= 3500):
        raise HTTPException(400, "invalid text length")
    sent, failed, note = broadcast_message(text, body.lang)
    row = Broadcast(admin_id=admin_user.id, text=text, lang_filter=body.lang, sent_count=sent, failed_count=failed)
    db.add(row)
    db.commit()
    audit_svc.audit_log(db, "admin.broadcast", actor_id=admin_user.id, actor_label=admin_user.email or f"tg:{admin_user.telegram_id}", detail={"sent": sent, "failed": failed, "lang": body.lang}, ip=client_ip(request))
    return {"ok": True, "sent": sent, "failed": failed, "note": note}


@router.get("/settings")
def get_settings_api(db: DbSession = Depends(get_session), user: User = Depends(admin)):
    s = get_settings()
    return {
        "ok": True,
        "pricing": gen_svc.get_pricing(db),
        "limits": {"gen_daily": s.gen_daily_limit, "welcome_credits": s.welcome_credits, "upload_max_mb": s.upload_max_mb},
        "public_url": s.public_url,
        "db": active_db_label,
        "smtp": bool(s.smtp_host),
        "bot_token": bool(s.bot_token),
    }


class SettingsIn(BaseModel):
    image: int | None = None
    video: int | None = None
    model_3d: int | None = None
    text: int | None = None


@router.put("/settings")
def put_settings(body: SettingsIn, request: Request, db: DbSession = Depends(get_session), admin_user: User = Depends(admin)):
    pricing = gen_svc.get_pricing(db)
    mapping = {"image": "image", "video": "video", "model_3d": "3d", "text": "text"}
    for field, key in mapping.items():
        val = getattr(body, field)
        if val is not None:
            if not (0 <= int(val) <= 100000):
                raise HTTPException(400, "invalid price")
            pricing[key] = int(val)
    gen_svc.set_pricing(db, pricing)
    audit_svc.audit_log(db, "admin.settings", actor_id=admin_user.id, actor_label=admin_user.email or f"tg:{admin_user.telegram_id}", detail=pricing, ip=client_ip(request))
    return {"ok": True, "pricing": pricing}


@router.get("/status")
def status(db: DbSession = Depends(get_session), user: User = Depends(viewer)):
    return {
        "ok": True,
        "database": {"ok": db_ok(), "engine": active_db_label},
        "bot": {
            "has_token": bool(get_settings().bot_token),
            "online": bot_state.online,
            "last_error": bot_state.last_error,
            "username": bot_state.username or get_settings().bot_username,
        },
        "worker": {"last_error": gen_worker_state.get("last_error")},
        "uptime_s": int(time.time() - START_TIME),
        "version": get_settings().version,
    }
