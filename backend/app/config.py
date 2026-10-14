from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "ZYVORA"
    environment: str = "development"
    database_url: str = "sqlite:///./zyvora-dev.db"
    jwt_secret: str = "dev-only-change-me-please-0123456789abcdef"
    jwt_algorithm: str = "HS256"
    access_token_minutes: int = 30  # spec: 30-60 min; the client refreshes transparently
    refresh_token_days: int = 30
    cookie_secure: bool = False
    cors_origins: str = "http://localhost:5173"
    require_email_verification: bool = False
    frontend_url: str = "http://localhost:5173"

    admin_email: str | None = None
    admin_password: str | None = None
    admin_name: str = "Administrator"

    # Rate limiting: max requests per window per client IP on sensitive routes
    rate_limit_per_minute: int = 20

    # AI provider keys. Missing key => adapter reports "provider not connected".
    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    meshy_api_key: str | None = None
    tripo_api_key: str | None = None
    stability_api_key: str | None = None
    video_provider_api_key: str | None = None
    audio_provider_api_key: str | None = None

    # Storage / render worker (not yet wired; reported honestly by admin panel)
    s3_endpoint: str | None = None
    s3_bucket: str | None = None
    redis_url: str | None = None

    # Payments (Stripe adapter reads these; not connected when empty)
    stripe_secret_key: str | None = None
    stripe_webhook_secret: str | None = None

    max_upload_mb: int = 50
    max_document_kb: int = 2048
    max_versions_kept: int = 50

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
