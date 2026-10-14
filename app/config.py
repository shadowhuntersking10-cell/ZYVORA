"""Central configuration. Everything is configurable via environment / .env file.

 SECURITY: never commit a real .env. See .env.example for placeholders.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = Path(os.getenv("ZYVORA_DATA_DIR", BASE_DIR / "data"))


def _load_dotenv() -> None:
    """Tiny .env loader (no external dependency). Does not override real env."""
    env_file = BASE_DIR / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        os.environ.setdefault(key, value)


_load_dotenv()


def _bool(name: str, default: bool = False) -> bool:
    v = os.getenv(name)
    if v is None:
        return default
    return v.strip().lower() in {"1", "true", "yes", "on"}


def _ints(name: str) -> list[int]:
    out: list[int] = []
    for part in os.getenv(name, "").replace(";", ",").split(","):
        part = part.strip()
        if part.isdigit():
            out.append(int(part))
    return out


def _default_mysql_url() -> str:
    host = os.getenv("MYSQL_HOST", "127.0.0.1")
    port = os.getenv("MYSQL_PORT", "3306")
    user = os.getenv("MYSQL_USER", "zyvora")
    password = os.getenv("MYSQL_PASSWORD", "zyvora")
    name = os.getenv("MYSQL_DATABASE", "zyvora")
    return f"mysql+pymysql://{user}:{password}@{host}:{port}/{name}?charset=utf8mb4"


@dataclass
class Settings:
    app_name: str = os.getenv("ZYVORA_NAME", "ZYVORA")
    version: str = "1.0.0"
    debug: bool = field(default_factory=lambda: _bool("ZYVORA_DEBUG", True))

    # Core server
    host: str = os.getenv("ZYVORA_HOST", "0.0.0.0")
    port: int = int(os.getenv("ZYVORA_PORT", "8000"))
    public_url: str = os.getenv("ZYVORA_PUBLIC_URL", "http://localhost:8000").rstrip("/")
    secret_key: str = os.getenv("ZYVORA_SECRET_KEY", "")
    session_days: int = int(os.getenv("ZYVORA_SESSION_DAYS", "14"))
    allowed_origins: list[str] = field(
        default_factory=lambda: [o for o in os.getenv("ZYVORA_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    )

    # Database: MySQL is the primary target, SQLite is a documented dev fallback.
    mysql_url: str = field(default_factory=_default_mysql_url)
    database_url: str = os.getenv("DATABASE_URL", "")
    allow_sqlite_fallback: bool = field(default_factory=lambda: _bool("ZYVORA_ALLOW_SQLITE_FALLBACK", True))
    require_mysql: bool = field(default_factory=lambda: _bool("ZYVORA_REQUIRE_MYSQL", False))
    db_echo: bool = field(default_factory=lambda: _bool("ZYVORA_DB_ECHO", False))

    # Telegram
    bot_token: str = os.getenv("BOT_TOKEN", "")
    bot_username: str = os.getenv("BOT_USERNAME", "")
    admin_ids: list[int] = field(default_factory=lambda: _ints("ZYVORA_ADMIN_IDS"))

    # Initial website admin (created on first start when provided)
    admin_email: str = os.getenv("ZYVORA_ADMIN_EMAIL", "")
    admin_password: str = os.getenv("ZYVORA_ADMIN_PASSWORD", "")

    # AI providers (all optional; features degrade honestly when missing)
    openai_api_key: str = os.getenv("OPENAI_API_KEY", "")
    openai_base_url: str = os.getenv("OPENAI_BASE_URL", "https://api.openai.com/v1")
    stability_api_key: str = os.getenv("STABILITY_API_KEY", "")
    meshy_api_key: str = os.getenv("MESHY_API_KEY", "")
    runway_api_key: str = os.getenv("RUNWAY_API_KEY", "")

    # Email (optional). Without SMTP configured the app says so honestly.
    smtp_host: str = os.getenv("SMTP_HOST", "")
    smtp_port: int = int(os.getenv("SMTP_PORT", "587"))
    smtp_user: str = os.getenv("SMTP_USER", "")
    smtp_password: str = os.getenv("SMTP_PASSWORD", "")
    smtp_from: str = os.getenv("SMTP_FROM", "")
    smtp_tls: bool = field(default_factory=lambda: _bool("SMTP_TLS", True))

    # Limits / pricing defaults (admin can change prices at runtime)
    welcome_credits: int = int(os.getenv("ZYVORA_WELCOME_CREDITS", "50"))
    upload_max_mb: int = int(os.getenv("ZYVORA_UPLOAD_MAX_MB", "5"))
    project_max_kb: int = int(os.getenv("ZYVORA_PROJECT_MAX_KB", "4096"))
    gen_daily_limit: int = int(os.getenv("ZYVORA_GEN_DAILY_LIMIT", "30"))
    gen_max_concurrent: int = int(os.getenv("ZYVORA_GEN_MAX_CONCURRENT", "2"))

    # Dev conveniences (never enabled implicitly in production)
    dev_webapp_bypass: bool = field(default_factory=lambda: _bool("ZYVORA_DEV_WEBAPP_BYPASS", False))

    @property
    def is_production(self) -> bool:
        return not self.debug

    @property
    def effective_database_url(self) -> str:
        return self.database_url or self.mysql_url

    @property
    def public_bot_username(self) -> str:
        return self.bot_username

    def validate(self) -> list[str]:
        problems: list[str] = []
        if self.is_production:
            if not self.secret_key or len(self.secret_key) < 32:
                problems.append("ZYVORA_SECRET_KEY must be set to a random 32+ char value in production.")
            if not self.bot_token:
                problems.append("BOT_TOKEN is empty: the Telegram bot will be offline.")
            if self.require_mysql and "mysql" not in self.effective_database_url:
                problems.append("ZYVORA_REQUIRE_MYSQL=1 but DATABASE_URL is not MySQL.")
        return problems


_settings: Settings | None = None


def get_settings() -> Settings:
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


def set_settings(s: Settings) -> None:
    global _settings
    _settings = s
