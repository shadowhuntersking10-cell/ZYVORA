from fastapi import Request
from sqlalchemy.orm import Session

from app.models import AuditLog


def client_ip(request: Request | None) -> str | None:
    if request is None or request.client is None:
        return None
    return request.client.host


def audit(
    db: Session,
    action: str,
    actor_id: str | None = None,
    target: str | None = None,
    detail: dict | None = None,
    request: Request | None = None,
) -> None:
    db.add(
        AuditLog(
            actor_id=actor_id,
            action=action,
            target=target,
            detail=detail or {},
            ip=client_ip(request),
        )
    )
