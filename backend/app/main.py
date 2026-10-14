import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.config import get_settings
from app.db import Base, engine
from app.routers import admin, ai, auth, projects

log = logging.getLogger("zyvora")


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    if settings.environment != "production" and settings.database_url.startswith("sqlite"):
        # Development convenience only. Production schema is managed by Alembic migrations.
        Base.metadata.create_all(bind=engine)
    if settings.environment == "production" and settings.jwt_secret.startswith("dev-only"):
        raise RuntimeError("JWT_SECRET must be set in production")
    yield


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="ZYVORA API", version="0.2.0", lifespan=lifespan,
                  docs_url="/api/docs" if settings.environment != "production" else None,
                  openapi_url="/api/openapi.json" if settings.environment != "production" else None)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        response.headers["Cross-Origin-Opener-Policy"] = "same-origin"
        if settings.environment == "production":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception):  # pragma: no cover
        log.exception("unhandled error on %s", request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    @app.get("/api/health")
    def health():
        return {"status": "ok", "app": settings.app_name}

    app.include_router(auth.router)
    app.include_router(projects.router)
    app.include_router(ai.router)
    app.include_router(admin.router)
    return app


app = create_app()
