"""FastAPI application factory."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from ..config import BASE_DIR, get_settings
from ..db import init_engine, session_factory
from ..i18n import t
from ..services.generation import GenerationWorker
from .routes_admin import gen_worker_state
from . import routes_admin, routes_api, routes_site

log = logging.getLogger("zyvora.server")

worker: GenerationWorker | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global worker
    settings = get_settings()
    init_engine()

    from ..db import create_all

    create_all()

    # background generation worker
    worker = GenerationWorker(session_factory)
    worker.start()

    # telegram bot (only with a real token; network errors are tolerated)
    bot_task = None
    if settings.bot_token:
        from ..bot.runner import run_bot

        bot_task = asyncio.get_running_loop().create_task(run_bot(settings.bot_token), name="tg-bot")
    else:
        log.warning("BOT_TOKEN is empty — the Telegram bot is offline (WebApp & website still work).")

    log.info("ZYVORA started: http://%s:%s", settings.host, settings.port)
    yield

    if worker:
        await worker.stop()
    if bot_task:
        bot_task.cancel()
        try:
            await bot_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass


import asyncio  # noqa: E402


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title=settings.app_name, version=settings.version, lifespan=lifespan, docs_url="/api/docs", openapi_url="/api/openapi.json")

    if settings.allowed_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.allowed_origins,
            allow_credentials=True,
            allow_methods=["*"],
            allow_headers=["*"],
        )

    # security headers
    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "same-origin"
        if settings.is_production:
            response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains"
        return response

    @app.exception_handler(404)
    async def not_found(request: Request, exc):
        if request.url.path.startswith(("/api/", "/assets/", "/static/")):
            return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
        from fastapi.responses import RedirectResponse

        return RedirectResponse("/", status_code=302)

    app.include_router(routes_site.router)
    app.include_router(routes_api.router)
    app.include_router(routes_admin.router)
    app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")
    return app
