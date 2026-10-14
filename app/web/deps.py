"""Request dependencies: dual auth (web cookie session / Telegram initData), CSRF, roles."""
from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session as DbSession

from ..config import get_settings
from ..db import get_session
from ..i18n import t
from ..models import User, utcnow
from ..security import validate_init_data
from ..services import audit as audit_svc

COOKIE_NAME = "zyvora_session"


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else ""


def get_current_user(
    request: Request,
    db: DbSession = Depends(get_session),
    x_telegram_init_data: str | None = Header(default=None, alias="X-Telegram-Init-Data"),
) -> User | None:
    """Dual authentication:
    1) Telegram Mini App initData header (HMAC-validated server-side);
    2) website cookie session.
    """
    settings = get_settings()

    if x_telegram_init_data:
        try:
            data = validate_init_data(x_telegram_init_data, settings.bot_token)
        except ValueError:
            raise HTTPException(status_code=401, detail="invalid telegram init data")
        tg_user = data.get("user") or {}
        tg_id = tg_user.get("id")
        if not tg_id:
            raise HTTPException(status_code=401, detail="no telegram user")
        user = db.query(User).filter_by(telegram_id=tg_id).first()
        if user is None:
            lang_map = {"uz": "uz", "ru": "ru", "en": "en"}
            name = " ".join(filter(None, [tg_user.get("first_name"), tg_user.get("last_name")])).strip() or tg_user.get("username") or f"tg{tg_id}"
            user = User(
                telegram_id=tg_id,
                username=tg_user.get("username"),
                full_name=name[:120],
                lang=lang_map.get((tg_user.get("language_code") or "uz")[:2], "uz"),
            )
            db.add(user)
            db.commit()
            from ..services import credits as credits_svc

            credits_svc.grant(db, user, settings.welcome_credits, "welcome", ref_id="signup", notify_user=False)
            audit_svc.audit_log(db, "user.register.tg", actor_id=user.id, actor_label=f"tg:{tg_id}", ip=client_ip(request))
        elif tg_user.get("username") != user.username:
            user.username = tg_user.get("username")
            db.commit()
        if user.is_banned:
            raise HTTPException(status_code=403, detail=t(user.lang, "error.banned", reason=user.ban_reason or ""))
        if tg_id in settings.admin_ids and user.role != "admin":
            user.role = "admin"
            db.commit()
            audit_svc.audit_log(db, "admin.promoted_env", actor_id=user.id, actor_label=f"tg:{tg_id}", detail={"via": "ADMIN_IDS"})
        user.last_seen_at = utcnow()
        db.commit()
        request.state.auth_source = "telegram"
        return user

    raw = request.cookies.get(COOKIE_NAME)
    if raw:
        from ..security import resolve_session

        user, sess = resolve_session(db, raw)
        if user is not None and sess is not None:
            request.state.auth_source = "cookie"
            request.state.session = sess
            user.last_seen_at = utcnow()
            db.commit()
            return user

    # Explicit dev-only bypass so the WebApp can be previewed in a plain browser.
    if settings.dev_webapp_bypass:
        user = db.query(User).filter_by(telegram_id=900000001).first()
        if user is None:
            user = User(telegram_id=900000001, username="dev_admin", full_name="Dev Admin", role="admin", lang="uz")
            db.add(user)
            db.commit()
            from ..services import credits as credits_svc

            credits_svc.grant(db, user, settings.welcome_credits, "welcome", ref_id="signup", notify_user=False)
        request.state.auth_source = "telegram"
        return user
    return None


def require_user(user: User | None = Depends(get_current_user)) -> User:
    if user is None:
        raise HTTPException(status_code=401, detail="authentication required")
    return user


def require_role(*roles: str):
    def dep(user: User = Depends(require_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="insufficient role")
        return user
    return dep


CSRF_EXEMPT_PATHS = {
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/forgot",
    "/api/auth/reset",
}


async def check_csrf(request: Request, db: DbSession = Depends(get_session), user: User | None = Depends(get_current_user)):
    """CSRF protection for cookie-authenticated state-changing requests.

    Auth endpoints are exempt (they authenticate by credentials, not by the
    cookie; SameSite=Lax already blocks cross-site POSTs).
    """
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    if request.url.path in CSRF_EXEMPT_PATHS:
        return
    if getattr(request.state, "auth_source", "") != "cookie":
        return  # telegram-header requests are not cookie-driven
    sess = getattr(request.state, "session", None)
    if sess is None:
        return
    token = request.headers.get("X-CSRF-Token", "")
    if not token:
        form_token = ""
        try:
            form = await request.form()
            form_token = str(form.get("_csrf", ""))
        except Exception:  # noqa: BLE001
            form_token = ""
        token = form_token
    if not token or token != sess.csrf_token:
        raise HTTPException(status_code=403, detail="CSRF token missing or invalid")
