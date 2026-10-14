from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.ai.providers import ADAPTERS
from app.audit import audit
from app.config import get_settings
from app.credits import PLAN_MONTHLY_AI_CREDITS, adjust_balance
from app.db import get_db
from app.deps import require_admin
from app.email import email_status
from app.models import AIJob, AuditLog, CreditLedger, Project, RefreshSession, User, utcnow
from app.schemas import AdminBlockIn, AdminCreditsIn, AdminUserPatch, UserOut

router = APIRouter(prefix="/api/admin", tags=["admin"], dependencies=[Depends(require_admin)])


def _user_row(u: User) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "name": u.name,
        "role": u.role,
        "plan": u.plan,
        "is_blocked": u.is_blocked,
        "email_verified": u.email_verified,
        "credit_balance": u.credit_balance,
        "created_at": u.created_at,
        "last_login_at": u.last_login_at,
    }


@router.get("/stats")
def stats(db: Session = Depends(get_db)):
    """Real database counts only. Empty tables return zeros, never invented numbers."""
    now = utcnow()
    day = now - timedelta(days=1)
    week = now - timedelta(days=7)
    count = lambda stmt: int(db.scalar(stmt) or 0)  # noqa: E731
    return {
        "users_total": count(select(func.count(User.id))),
        "users_blocked": count(select(func.count(User.id)).where(User.is_blocked.is_(True))),
        "signups_24h": count(select(func.count(User.id)).where(User.created_at >= day)),
        "signups_7d": count(select(func.count(User.id)).where(User.created_at >= week)),
        "projects_total": count(select(func.count(Project.id)).where(Project.deleted_at.is_(None))),
        "ai_jobs_total": count(select(func.count(AIJob.id))),
        "ai_jobs_failed": count(select(func.count(AIJob.id)).where(AIJob.status == "failed")),
        "ai_jobs_not_connected": count(select(func.count(AIJob.id)).where(AIJob.status == "not_connected")),
        "login_failures_24h": count(select(func.count(AuditLog.id)).where(
            AuditLog.created_at >= day, AuditLog.action.in_(["auth.login_failed"]))),
        "confirmed_payments": 0,  # no payment gateway connected: always 0 until real webhooks exist
        "credits_granted_total": count(select(func.coalesce(func.sum(CreditLedger.delta), 0))
                                       .where(CreditLedger.delta > 0)),
        "payments_gateway": {"provider": "stripe", "connected": bool(get_settings().stripe_secret_key)},
    }


@router.get("/users")
def list_users(q: str | None = None, limit: int = 50, offset: int = 0, db: Session = Depends(get_db)):
    stmt = select(User)
    if q:
        like = f"%{q.strip().lower()}%"
        stmt = stmt.where(or_(User.email.ilike(like), User.name.ilike(like)))
    total = int(db.scalar(select(func.count()).select_from(stmt.subquery())) or 0)
    rows = db.scalars(stmt.order_by(User.created_at.desc()).limit(min(limit, 200)).offset(offset)).all()
    return {"total": total, "items": [_user_row(u) for u in rows]}


@router.get("/users/{user_id}")
def get_user(user_id: str, db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if u is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    projects = int(db.scalar(select(func.count(Project.id)).where(
        Project.owner_id == u.id, Project.deleted_at.is_(None))) or 0)
    jobs = int(db.scalar(select(func.count(AIJob.id)).where(AIJob.user_id == u.id)) or 0)
    ledger = db.scalars(select(CreditLedger).where(CreditLedger.user_id == u.id)
                        .order_by(CreditLedger.created_at.desc()).limit(50)).all()
    return {
        **_user_row(u),
        "projects": projects,
        "ai_jobs": jobs,
        "active_sessions": int(db.scalar(select(func.count(RefreshSession.id)).where(
            RefreshSession.user_id == u.id, RefreshSession.revoked.is_(False))) or 0),
        "credit_ledger": [
            {"delta": e.delta, "balance_after": e.balance_after, "reason": e.reason,
             "reference": e.reference, "created_at": e.created_at} for e in ledger
        ],
        "monthly_ai_limit": PLAN_MONTHLY_AI_CREDITS.get(u.plan, 0),
    }


def _guard_last_admin(db: Session, target: User) -> None:
    if target.role == "admin":
        others = db.scalar(select(func.count(User.id)).where(
            User.role == "admin", User.is_blocked.is_(False), User.id != target.id))
        if not others:
            raise HTTPException(status.HTTP_409_CONFLICT, "Cannot remove or block the last active admin")


@router.post("/users/{user_id}/block")
def set_blocked(user_id: str, body: AdminBlockIn, request: Request, actor: User = Depends(require_admin),
                db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    if target.id == actor.id and body.blocked:
        raise HTTPException(status.HTTP_409_CONFLICT, "You cannot block yourself")
    if body.blocked:
        _guard_last_admin(db, target)
    target.is_blocked = body.blocked
    if body.blocked:
        for s in db.scalars(select(RefreshSession).where(RefreshSession.user_id == target.id)):
            s.revoked = True
    audit(db, "admin.user_block" if body.blocked else "admin.user_restore", actor_id=actor.id,
          target=target.id, detail={"reason": body.reason}, request=request)
    db.commit()
    return _user_row(target)


@router.patch("/users/{user_id}")
def patch_user(user_id: str, body: AdminUserPatch, request: Request, actor: User = Depends(require_admin),
               db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    changes: dict = {}
    if body.role is not None and body.role != target.role:
        if target.id == actor.id and body.role != "admin":
            raise HTTPException(status.HTTP_409_CONFLICT, "You cannot remove your own admin role")
        if target.role == "admin" and body.role != "admin":
            _guard_last_admin(db, target)
        changes["role"] = [target.role, body.role]
        target.role = body.role
    if body.plan is not None and body.plan != target.plan:
        changes["plan"] = [target.plan, body.plan]
        target.plan = body.plan
    if changes:
        audit(db, "admin.user_update", actor_id=actor.id, target=target.id, detail=changes, request=request)
    db.commit()
    return _user_row(target)


@router.post("/users/{user_id}/credits")
def adjust_credits(user_id: str, body: AdminCreditsIn, request: Request, actor: User = Depends(require_admin),
                   db: Session = Depends(get_db)):
    target = db.get(User, user_id)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    balance = adjust_balance(db, target, body.delta, reason=f"admin.adjust: {body.reason}", actor_id=actor.id)
    audit(db, "admin.credits_adjust", actor_id=actor.id, target=target.id,
          detail={"delta": body.delta, "reason": body.reason, "balance_after": balance}, request=request)
    db.commit()
    return _user_row(target)


@router.get("/audit")
def audit_log(limit: int = 100, action: str | None = None, db: Session = Depends(get_db)):
    stmt = select(AuditLog).order_by(AuditLog.created_at.desc()).limit(min(limit, 500))
    if action:
        stmt = stmt.where(AuditLog.action.startswith(action))
    return [
        {"id": a.id, "actor_id": a.actor_id, "action": a.action, "target": a.target,
         "detail": a.detail, "ip": a.ip, "created_at": a.created_at}
        for a in db.scalars(stmt).all()
    ]


@router.get("/jobs")
def jobs(status_filter: str | None = None, limit: int = 100, db: Session = Depends(get_db)):
    stmt = select(AIJob).order_by(AIJob.created_at.desc()).limit(min(limit, 500))
    if status_filter:
        stmt = stmt.where(AIJob.status == status_filter)
    return [
        {"id": j.id, "user_id": j.user_id, "provider": j.provider, "task": j.task, "status": j.status,
         "error": j.error, "charged_credits": j.charged_credits, "created_at": j.created_at}
        for j in db.scalars(stmt).all()
    ]


@router.get("/providers")
def providers(db: Session = Depends(get_db)):
    """Connection status only. Keys are never returned."""
    out = []
    for a in ADAPTERS.values():
        jobs_total = int(db.scalar(select(func.count(AIJob.id)).where(AIJob.provider == a.name)) or 0)
        failed = int(db.scalar(select(func.count(AIJob.id)).where(
            AIJob.provider == a.name, AIJob.status == "failed")) or 0)
        spent = int(db.scalar(select(func.coalesce(func.sum(AIJob.charged_credits), 0)).where(
            AIJob.provider == a.name)) or 0)
        out.append({**a.status_info(), "jobs_total": jobs_total, "jobs_failed": failed,
                    "credits_charged": spent})
    return out


@router.get("/system")
def system(db: Session = Depends(get_db)):
    s = get_settings()
    db_ok = True
    try:
        db.execute(select(1))
    except Exception:  # pragma: no cover
        db_ok = False
    return {
        "environment": s.environment,
        "database": {"connected": db_ok, "engine": db.get_bind().dialect.name},
        "email": email_status(),
        "storage": {"connected": bool(s.s3_endpoint), "reason": None if s.s3_endpoint else "S3 not configured"},
        "redis_queue": {"connected": bool(s.redis_url), "reason": None if s.redis_url else "Redis not configured"},
        "render_worker": {"connected": False, "reason": "Blender/ffmpeg render worker not built yet"},
        "payments": {"connected": bool(s.stripe_secret_key and s.stripe_webhook_secret),
                     "reason": None if s.stripe_secret_key else "Stripe not configured"},
        "limits": {"max_upload_mb": s.max_upload_mb, "max_document_kb": s.max_document_kb},
    }


@router.get("/payments")
def payments(db: Session = Depends(get_db)):
    """No gateway is connected, so there are no orders or subscriptions. Nothing is simulated."""
    s = get_settings()
    return {
        "gateway": {"provider": "stripe", "connected": bool(s.stripe_secret_key and s.stripe_webhook_secret)},
        "orders": [],
        "subscriptions": [],
        "refunds": [],
    }
