"""Security core: Argon2id password hashing, server-side sessions, CSRF, Telegram initData."""
from __future__ import annotations

import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime
from urllib.parse import parse_qsl

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError, VerificationError, InvalidHashError
from sqlalchemy.orm import Session as DbSession

from .config import get_settings
from .models import AuthSession, User, utcnow

_ph = PasswordHasher(time_cost=3, memory_cost=64 * 1024, parallelism=4)


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    if not password_hash:
        return False
    try:
        return _ph.verify(password_hash, password)
    except (VerifyMismatchError, VerificationError, InvalidHashError):
        return False


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def create_session(db: DbSession, user: User, *, source: str = "web", ip: str = "", user_agent: str = "") -> AuthSession:
    settings = get_settings()
    raw = new_token(32)
    from datetime import timedelta

    sess = AuthSession(
        token_hash=sha256_hex(raw),
        user_id=user.id,
        source=source,
        ip=ip[:60],
        user_agent=user_agent[:250],
        csrf_token=new_token(24),
        expires_at=utcnow() + timedelta(days=settings.session_days),
    )
    db.add(sess)
    db.commit()
    sess.__dict__["raw_token"] = raw  # available to the caller only, never stored
    return sess


def resolve_session(db: DbSession, raw_token: str | None) -> tuple[User | None, AuthSession | None]:
    if not raw_token:
        return None, None
    sess = db.query(AuthSession).filter_by(token_hash=sha256_hex(raw_token)).first()
    if not sess or sess.revoked_at is not None or sess.expires_at < utcnow():
        return None, None
    user = db.get(User, sess.user_id)
    if not user or user.is_banned:
        return None, None
    return user, sess


def revoke_session(db: DbSession, sess: AuthSession) -> None:
    sess.revoked_at = utcnow()
    db.commit()


def revoke_all_sessions(db: DbSession, user_id: int, exclude: int | None = None) -> int:
    q = db.query(AuthSession).filter(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None))
    if exclude is not None:
        q = q.filter(AuthSession.id != exclude)
    n = 0
    now = utcnow()
    for s in q.all():
        s.revoked_at = now
        n += 1
    db.commit()
    return n


# ----------------------------- Telegram Mini App -----------------------------

def _telegram_secret_key(bot_token: str) -> bytes:
    return hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()


def parse_init_data(init_data: str) -> dict:
    """Parse raw Telegram WebApp initData string into a dict (no validation)."""
    result: dict[str, str] = {}
    for key, value in parse_qsl(init_data, keep_blank_values=True):
        result[key] = value
    return result


def validate_init_data(init_data: str, bot_token: str, *, max_age_seconds: int = 86400) -> dict:
    """Validate Telegram WebApp initData signature per official algorithm.

    Returns parsed data (with `user` as dict) or raises ValueError with a reason.
    """
    if not init_data:
        raise ValueError("empty init data")
    if not bot_token:
        raise ValueError("server has no bot token configured")
    parsed = parse_init_data(init_data)
    received_hash = parsed.pop("hash", None)
    if not received_hash:
        raise ValueError("missing hash")
    data_check_string = "\n".join(f"{k}={parsed[k]}" for k in sorted(parsed.keys()))
    secret_key = _telegram_secret_key(bot_token)
    calc_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(calc_hash, received_hash):
        raise ValueError("invalid signature")
    auth_date = int(parsed.get("auth_date", "0"))
    if auth_date and time.time() - auth_date > max_age_seconds:
        raise ValueError("init data expired")
    if "user" in parsed:
        try:
            parsed["user"] = json.loads(parsed["user"])
        except json.JSONDecodeError:
            raise ValueError("bad user payload")
    return parsed
