"""Audit logging and user notifications."""
from __future__ import annotations

from sqlalchemy.orm import Session as DbSession

from ..models import AuditLog, Notification


def audit_log(
    db: DbSession,
    action: str,
    *,
    actor_id: int | None = None,
    actor_label: str = "system",
    target: str = "",
    detail: dict | None = None,
    ip: str = "",
    commit: bool = True,
) -> AuditLog:
    entry = AuditLog(
        actor_id=actor_id,
        actor_label=actor_label[:120],
        action=action[:64],
        target=target[:120],
        detail=detail or {},
        ip=ip[:60],
    )
    db.add(entry)
    if commit:
        db.commit()
    return entry


def notify(db: DbSession, user_id: int, kind: str, text: str, *, commit: bool = True) -> None:
    db.add(Notification(user_id=user_id, kind=kind[:24], text=text))
    if commit:
        db.commit()
