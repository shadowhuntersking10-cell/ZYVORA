from datetime import datetime, timedelta, timezone

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.audit import audit
from app.config import get_settings
from app.db import get_db
from app.deps import client_meta, get_current_user
from app.email import send_email
from app.models import OneTimeToken, RefreshSession, User, utcnow
from app.ratelimit import rate_limit
from app.schemas import (
    AuthOut,
    ChangePasswordIn,
    DeleteAccountIn,
    EmailIn,
    LoginIn,
    ProfileIn,
    RegisterIn,
    RegisterOut,
    ResendIn,
    ResetIn,
    SessionOut,
    TokenIn,
    UserOut,
)
from app.security import (
    create_access_token,
    hash_password,
    hash_token,
    new_opaque_token,
    verify_password,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])

REFRESH_COOKIE = "zyvora_refresh"
REFRESH_PATH = "/api/auth"
DUMMY_HASH = hash_password("dummy-password-for-timing-1")


def _as_aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _set_refresh_cookie(response: Response, token: str, remember: bool = True) -> None:
    s = get_settings()
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        # remember=False gives a browser-session cookie (gone when the browser closes).
        max_age=s.refresh_token_days * 86400 if remember else None,
        httponly=True,
        secure=s.cookie_secure,
        samesite="strict",
        path=REFRESH_PATH,
    )


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(REFRESH_COOKIE, path=REFRESH_PATH)


def _issue_session(db: Session, user: User, request: Request, response: Response, remember: bool = True) -> str:
    raw = new_opaque_token()
    ua, ip = client_meta(request)
    db.add(
        RefreshSession(
            user_id=user.id,
            token_hash=hash_token(raw),
            user_agent=ua,
            ip=ip,
            remember=remember,
            expires_at=utcnow() + timedelta(days=get_settings().refresh_token_days),
        )
    )
    _set_refresh_cookie(response, raw, remember)
    return create_access_token(user.id, user.role)


def _issue_one_time(db: Session, user: User, purpose: str, hours: int) -> str:
    raw = new_opaque_token()
    db.add(
        OneTimeToken(
            user_id=user.id,
            purpose=purpose,
            token_hash=hash_token(raw),
            expires_at=utcnow() + timedelta(hours=hours),
        )
    )
    return raw


@router.post("/register", response_model=RegisterOut, status_code=201,
             dependencies=[Depends(rate_limit("register"))])
def register(body: RegisterIn, request: Request, db: Session = Depends(get_db)):
    email = body.email.lower()
    if db.scalar(select(User).where(User.email == email)):
        # Generic response to avoid account enumeration would need email delivery; keep explicit for UX.
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    settings = get_settings()
    verification_required = settings.require_email_verification
    user = User(
        email=email,
        name=body.name.strip(),
        password_hash=hash_password(body.password),
        email_verified=not verification_required,
        credit_balance=0,
    )
    db.add(user)
    db.flush()
    delivery = "not_connected"
    if verification_required:
        raw = _issue_one_time(db, user, "verify_email", 48)
        link = f"{settings.frontend_url}/verify-email?token={raw}"
        if send_email(email, "Verify your ZYVORA account", f"Verify: {link}"):
            delivery = "sent"
    audit(db, "auth.register", actor_id=user.id, target=user.id, request=request)
    db.commit()
    return RegisterOut(user=UserOut.model_validate(user), verification_required=verification_required,
                       email_delivery=delivery)


@router.post("/login", response_model=AuthOut, dependencies=[Depends(rate_limit("login"))])
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    if user is None:
        verify_password(body.password, DUMMY_HASH)
        audit(db, "auth.login_failed", detail={"reason": "unknown_email"}, request=request)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if not verify_password(body.password, user.password_hash):
        audit(db, "auth.login_failed", actor_id=user.id, detail={"reason": "bad_password"}, request=request)
        db.commit()
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")
    if user.is_blocked or not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is blocked")
    if not user.email_verified:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Email is not verified")
    user.last_login_at = utcnow()
    access = _issue_session(db, user, request, response, remember=body.remember)
    audit(db, "auth.login", actor_id=user.id, request=request)
    db.commit()
    return AuthOut(access_token=access, user=UserOut.model_validate(user))


@router.post("/refresh", response_model=AuthOut)
def refresh(request: Request, response: Response, db: Session = Depends(get_db)):
    raw = request.cookies.get(REFRESH_COOKIE)
    if not raw:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "No session")
    sess = db.scalar(select(RefreshSession).where(RefreshSession.token_hash == hash_token(raw)))
    if sess is None or sess.revoked or _as_aware(sess.expires_at) < utcnow():
        _clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    user = db.get(User, sess.user_id)
    if user is None or user.is_blocked or not user.is_active:
        sess.revoked = True
        db.commit()
        _clear_refresh_cookie(response)
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Account is blocked")
    # Rotation: the old refresh token is revoked and a new one is issued.
    sess.revoked = True
    access = _issue_session(db, user, request, response, remember=sess.remember)
    db.commit()
    return AuthOut(access_token=access, user=UserOut.model_validate(user))


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    raw = request.cookies.get(REFRESH_COOKIE)
    if raw:
        sess = db.scalar(select(RefreshSession).where(RefreshSession.token_hash == hash_token(raw)))
        if sess:
            sess.revoked = True
            db.commit()
    _clear_refresh_cookie(response)
    response.status_code = 204
    return response


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)):
    return UserOut.model_validate(user)


@router.patch("/me", response_model=UserOut)
def update_me(body: ProfileIn, request: Request, user: User = Depends(get_current_user),
              db: Session = Depends(get_db)):
    if body.name is not None:
        user.name = body.name.strip()
    if body.avatar_url is not None:
        if body.avatar_url and not body.avatar_url.startswith(("https://", "/")):
            raise HTTPException(422, "avatar_url must be https or a relative path")
        user.avatar_url = body.avatar_url or None
    audit(db, "auth.profile_update", actor_id=user.id, target=user.id, request=request)
    db.commit()
    return UserOut.model_validate(user)


@router.post("/me/password", status_code=204)
def change_password(body: ChangePasswordIn, request: Request, user: User = Depends(get_current_user),
                    db: Session = Depends(get_db)):
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Current password is incorrect")
    user.password_hash = hash_password(body.new_password)
    # Sign out every other session.
    for s in db.scalars(select(RefreshSession).where(RefreshSession.user_id == user.id)):
        s.revoked = True
    audit(db, "auth.password_changed", actor_id=user.id, target=user.id, request=request)
    db.commit()
    return Response(status_code=204)


@router.get("/me/sessions", response_model=list[SessionOut])
def list_sessions(request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    current_raw = request.cookies.get(REFRESH_COOKIE)
    current_hash = hash_token(current_raw) if current_raw else None
    rows = db.scalars(
        select(RefreshSession)
        .where(RefreshSession.user_id == user.id, RefreshSession.revoked.is_(False))
        .order_by(RefreshSession.created_at.desc())
    ).all()
    return [
        SessionOut(id=s.id, user_agent=s.user_agent, ip=s.ip, created_at=s.created_at,
                   expires_at=s.expires_at, current=(s.token_hash == current_hash))
        for s in rows
        if _as_aware(s.expires_at) > utcnow()
    ]


@router.delete("/me/sessions/{session_id}", status_code=204)
def revoke_session(session_id: str, request: Request, user: User = Depends(get_current_user),
                   db: Session = Depends(get_db)):
    sess = db.get(RefreshSession, session_id)
    if sess is None or sess.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Session not found")
    sess.revoked = True
    audit(db, "auth.session_revoked", actor_id=user.id, target=session_id, request=request)
    db.commit()
    return Response(status_code=204)


@router.post("/me/delete", status_code=204)
def delete_account(body: DeleteAccountIn, request: Request, response: Response,
                   user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Password is incorrect")
    if user.role == "admin":
        other_admins = db.scalar(select(User.id).where(User.role == "admin", User.id != user.id).limit(1))
        if other_admins is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "The last administrator cannot delete their account")
    audit(db, "auth.account_deleted", actor_id=None, target=user.id,
          detail={"email_hash": hash_token(user.email)}, request=request)
    db.delete(user)
    db.commit()
    _clear_refresh_cookie(response)
    return Response(status_code=204)


@router.post("/resend-verification", status_code=202, dependencies=[Depends(rate_limit("resend"))])
def resend_verification(body: ResendIn, request: Request, db: Session = Depends(get_db)):
    """Always 202 so the response does not reveal which emails exist."""
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    delivery = "not_connected"
    if user is not None and not user.email_verified and get_settings().require_email_verification:
        raw = _issue_one_time(db, user, "verify_email", 48)
        link = f"{get_settings().frontend_url}/verify-email?token={raw}"
        if send_email(user.email, "Verify your ZYVORA account", f"Verify: {link}"):
            delivery = "sent"
        audit(db, "auth.verification_resent", actor_id=user.id, request=request)
        db.commit()
    return {"status": "accepted", "email_delivery": delivery}


@router.post("/forgot", status_code=202, dependencies=[Depends(rate_limit("forgot"))])
def forgot_password(body: EmailIn, request: Request, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.email == body.email.lower()))
    delivery = "not_connected"
    if user is not None:
        raw = _issue_one_time(db, user, "reset_password", 2)
        link = f"{get_settings().frontend_url}/reset-password?token={raw}"
        if send_email(user.email, "Reset your ZYVORA password", f"Reset: {link}"):
            delivery = "sent"
        audit(db, "auth.password_reset_requested", actor_id=user.id, request=request)
        db.commit()
    return {"status": "accepted", "email_delivery": delivery}


def _consume_token(db: Session, raw: str, purpose: str) -> User:
    tok = db.scalar(select(OneTimeToken).where(OneTimeToken.token_hash == hash_token(raw),
                                               OneTimeToken.purpose == purpose))
    if tok is None or tok.used or _as_aware(tok.expires_at) < utcnow():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Link is invalid or expired")
    tok.used = True
    user = db.get(User, tok.user_id)
    if user is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Link is invalid or expired")
    return user


@router.post("/verify-email", status_code=204)
def verify_email(body: TokenIn, request: Request, db: Session = Depends(get_db)):
    user = _consume_token(db, body.token, "verify_email")
    user.email_verified = True
    audit(db, "auth.email_verified", actor_id=user.id, request=request)
    db.commit()
    return Response(status_code=204)


@router.post("/reset-password", status_code=204)
def reset_password(body: ResetIn, request: Request, db: Session = Depends(get_db)):
    user = _consume_token(db, body.token, "reset_password")
    user.password_hash = hash_password(body.password)
    for s in db.scalars(select(RefreshSession).where(RefreshSession.user_id == user.id)):
        s.revoked = True
    audit(db, "auth.password_reset", actor_id=user.id, request=request)
    db.commit()
    return Response(status_code=204)
