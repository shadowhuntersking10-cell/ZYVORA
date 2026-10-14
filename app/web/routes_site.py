"""HTML routes: landing, auth pages, dashboard/webapp shells, health."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, Request
from fastapi.responses import FileResponse, HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session as DbSession

from ..config import BASE_DIR, get_settings
from ..db import active_db_label, db_ok, get_session
from ..i18n import normalize_lang, t
from ..models import EmailToken, User, utcnow
from ..security import sha256_hex
from ..services.emailer import smtp_configured
from .deps import COOKIE_NAME, client_ip, get_current_user

templates = Jinja2Templates(directory=str(BASE_DIR / "app" / "web" / "templates"))
router = APIRouter()


def _lang_for(request: Request, user: User | None) -> str:
    qlang = request.query_params.get("lang")
    if qlang:
        return normalize_lang(qlang)
    if user is not None:
        return normalize_lang(user.lang)
    return normalize_lang(request.cookies.get("zyvora_lang", "uz"))


def _base_ctx(request: Request, lang: str, user: User | None = None) -> dict:
    s = get_settings()
    return {
        "request": request,
        "lang": lang,
        "t": lambda key, **kw: t(lang, key, **kw),
        "app_name": s.app_name,
        "user": user.to_public() if user else None,
        "bot_username": s.bot_username or "",
        "public_url": s.public_url,
    }


@router.get("/set-lang")
def set_lang(request: Request, lang: str, next_url: str = "/"):
    from urllib.parse import quote

    lang = normalize_lang(lang)
    target = next_url if next_url.startswith("/") else "/"
    sep = "&" if "?" in target else "?"
    resp = RedirectResponse(f"{target}{sep}lang={lang}", status_code=302)
    resp.set_cookie("zyvora_lang", lang, max_age=365 * 86400, samesite="lax")
    return resp


@router.get("/", response_class=HTMLResponse)
def landing(request: Request, db: DbSession = Depends(get_session)):
    user = get_current_user_sync(request, db)
    lang = _lang_for(request, user)
    return templates.TemplateResponse(request, "index.html", _base_ctx(request, lang, user))


def get_current_user_sync(request: Request, db: DbSession) -> User | None:
    """Cookie-only auth for HTML pages (Telegram header auth is for the API/SPA)."""
    from ..security import resolve_session

    raw = request.cookies.get(COOKIE_NAME)
    if not raw:
        return None
    user, sess = resolve_session(db, raw)
    return user


@router.get("/login", response_class=HTMLResponse)
def login_page(request: Request, db: DbSession = Depends(get_session)):
    user = get_current_user_sync(request, db)
    if user:
        return RedirectResponse("/dashboard", status_code=302)
    lang = _lang_for(request, None)
    return templates.TemplateResponse(request, "auth.html", {**_base_ctx(request, lang), "mode": "login"})


@router.get("/register", response_class=HTMLResponse)
def register_page(request: Request, db: DbSession = Depends(get_session)):
    user = get_current_user_sync(request, db)
    if user:
        return RedirectResponse("/dashboard", status_code=302)
    lang = _lang_for(request, None)
    return templates.TemplateResponse(request, "auth.html", {**_base_ctx(request, lang), "mode": "register"})


@router.get("/forgot-password", response_class=HTMLResponse)
def forgot_page(request: Request):
    lang = _lang_for(request, None)
    return templates.TemplateResponse(request, "auth.html", {**_base_ctx(request, lang), "mode": "forgot"})


@router.get("/reset-password", response_class=HTMLResponse)
def reset_page(request: Request):
    lang = _lang_for(request, None)
    return templates.TemplateResponse(request, "auth.html", {**_base_ctx(request, lang), "mode": "reset", "token": request.query_params.get("token", "")})


@router.get("/verify-email", response_class=HTMLResponse)
def verify_email(request: Request, db: DbSession = Depends(get_session)):
    token = request.query_params.get("token", "")
    lang = _lang_for(request, None)
    row = db.query(EmailToken).filter_by(token_hash=sha256_hex(token), kind="verify", used_at=None).first() if token else None
    ok = False
    if row and row.expires_at > utcnow():
        user = db.get(User, row.user_id)
        if user:
            user.email_verified = True
            row.used_at = utcnow()
            db.commit()
            ok = True
    return templates.TemplateResponse(request, "verify.html", {**_base_ctx(request, lang), "ok": ok})


@router.get("/dashboard", response_class=HTMLResponse)
def dashboard(request: Request, db: DbSession = Depends(get_session)):
    user = get_current_user_sync(request, db)
    if user is None:
        return RedirectResponse("/login?next=/dashboard", status_code=302)
    if user.is_banned:
        resp = RedirectResponse("/login", status_code=302)
        resp.delete_cookie(COOKIE_NAME)
        return resp
    lang = _lang_for(request, user)
    ctx = _base_ctx(request, lang, user)
    import json

    from ..i18n import lang_pack

    ctx.update({"mode": "site", "lang_pack_json": json.dumps(lang_pack(lang), ensure_ascii=False)})
    return templates.TemplateResponse(request, "app.html", ctx)


@router.get("/app", response_class=HTMLResponse)
def webapp_page(request: Request, db: DbSession = Depends(get_session)):
    s = get_settings()
    lang = _lang_for(request, None)
    ctx = _base_ctx(request, lang)
    import json

    from ..i18n import lang_pack

    ctx.update({"mode": "telegram", "lang_pack_json": json.dumps(lang_pack(lang), ensure_ascii=False)})
    return templates.TemplateResponse(request, "app.html", ctx)


@router.get("/health")
def health(db: DbSession = Depends(get_session)):
    from ..bot.runner import bot_state

    s = get_settings()
    return {
        "status": "ok" if db_ok() else "degraded",
        "app": s.app_name,
        "version": s.version,
        "database": {"ok": db_ok(), "engine": active_db_label},
        "bot": {"has_token": bool(s.bot_token), "online": bot_state.online},
        "email_delivery": smtp_configured(),
        "time": utcnow().isoformat(),
    }


@router.get("/favicon.ico")
def favicon():
    p = BASE_DIR / "static" / "img" / "favicon.svg"
    if p.exists():
        return FileResponse(p, media_type="image/svg+xml")
    raise FileResponse


@router.get("/data/{rel_path:path}")
def serve_user_file(rel_path: str, request: Request, db: DbSession = Depends(get_session)):
    """Serves generated/uploaded files with ownership checks.

    Allowed layout: uploads/{uid}/... and gen/{uid}/...
    """
    from fastapi import HTTPException

    from ..config import DATA_DIR

    user = get_current_user_sync(request, db)
    if user is None:
        raise HTTPException(401, "authentication required")
    parts = [p for p in rel_path.split("/") if p not in ("", ".", "..")]
    if len(parts) < 2 or parts[0] not in ("uploads", "gen"):
        raise HTTPException(404, "not found")
    try:
        owner_uid = int(parts[1])
    except ValueError:
        raise HTTPException(404, "not found")
    if owner_uid != user.id and user.role not in ("admin", "moderator"):
        raise HTTPException(403, "forbidden")
    target = (DATA_DIR / Path(*parts)).resolve()
    if not str(target).startswith(str(DATA_DIR.resolve())):
        raise HTTPException(404, "not found")
    if not target.exists() or not target.is_file():
        raise HTTPException(404, "not found")
    import mimetypes

    mime = mimetypes.guess_type(target.name)[0] or "application/octet-stream"
    return FileResponse(target, media_type=mime)
