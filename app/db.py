"""Database engine management: MySQL primary, SQLite dev-fallback, auto-create schema."""
from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from .config import DATA_DIR, get_settings

_engine: Engine | None = None
_SessionLocal: sessionmaker | None = None
active_db_label: str = "not-initialized"


def _mysql_server_exists(url: str) -> bool:
    """Check that a MySQL server accepts the connection (without database)."""
    try:
        from urllib.parse import urlsplit

        parts = urlsplit(url)
        host = parts.hostname or "127.0.0.1"
        port = parts.port or 3306
        user = parts.username or ""
        password = parts.password or ""
        import pymysql

        conn = pymysql.connect(host=host, port=port, user=user, password=password, connect_timeout=4)
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        conn.close()
        return True
    except Exception as exc:  # noqa: BLE001 - report any failure honestly
        print(f"[db] MySQL server check failed: {exc}", file=sys.stderr)
        return False


def ensure_mysql_database(url: str) -> bool:
    """CREATE DATABASE IF NOT EXISTS for MySQL URLs."""
    try:
        from urllib.parse import urlsplit

        parts = urlsplit(url)
        host = parts.hostname or "127.0.0.1"
        port = parts.port or 3306
        user = parts.username or ""
        password = parts.password or ""
        dbname = (parts.path or "/").lstrip("/")
        if not dbname:
            return False
        import pymysql

        conn = pymysql.connect(host=host, port=port, user=user, password=password, connect_timeout=4)
        with conn.cursor() as cur:
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{dbname}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
            )
        conn.commit()
        conn.close()
        return True
    except Exception as exc:  # noqa: BLE001
        print(f"[db] MySQL database bootstrap failed: {exc}", file=sys.stderr)
        return False


def init_engine(echo: bool | None = None) -> Engine:
    """Create the global engine. MySQL first; honest, loud SQLite fallback for dev."""
    global _engine, _SessionLocal, active_db_label
    if _engine is not None:
        return _engine

    settings = get_settings()
    url = settings.effective_database_url

    if url.startswith("mysql"):
        if not _mysql_server_exists(url):
            if settings.require_mysql:
                raise RuntimeError(
                    "MySQL is required (ZYVORA_REQUIRE_MYSQL=1) but the server is unreachable. "
                    f"Tried: {url.split('@')[-1]}"
                )
            if not settings.allow_sqlite_fallback:
                raise RuntimeError("MySQL unreachable and SQLite fallback disabled by configuration.")
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            url = f"sqlite:///{DATA_DIR / 'zyvora.db'}"
            print(
                "\n" + "!" * 72
                + "\n[db] WARNING: MySQL is unreachable - falling back to local SQLite for development.\n"
                "[db] This is NOT recommended for production. Set MYSQL_* env vars correctly\n"
                "[db] or start ZYVORA_REQUIRE_MYSQL=1 to forbid the fallback.\n" + "!" * 72 + "\n",
                file=sys.stderr,
            )
        else:
            ensure_mysql_database(url)
            active_db_label = "MySQL"
    elif url.startswith("sqlite"):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        active_db_label = "SQLite (dev)"

    kwargs: dict = {"echo": settings.db_echo if echo is None else echo, "future": True}
    if url.startswith("mysql"):
        kwargs["pool_pre_ping"] = True
        kwargs["pool_recycle"] = 3600
        kwargs["pool_size"] = 10
        kwargs["max_overflow"] = 20
    else:
        kwargs["connect_args"] = {"check_same_thread": False}

    _engine = create_engine(url, **kwargs)
    if url.startswith("sqlite"):
        from sqlalchemy import event

        @event.listens_for(_engine, "connect")
        def _fk_pragma(dbapi_conn, _record):  # noqa: ANN001
            cur = dbapi_conn.cursor()
            cur.execute("PRAGMA foreign_keys=ON")
            cur.execute("PRAGMA journal_mode=WAL")
            cur.close()

    _SessionLocal = sessionmaker(bind=_engine, autoflush=False, expire_on_commit=False, future=True)
    active_db_label = "MySQL" if url.startswith("mysql") else "SQLite (dev)"
    return _engine


def get_engine() -> Engine:
    return _engine if _engine is not None else init_engine()


def session_factory() -> sessionmaker:
    get_engine()
    assert _SessionLocal is not None
    return _SessionLocal


def get_session():
    """FastAPI dependency: yields a scoped session."""
    db = session_factory()()
    try:
        yield db
    finally:
        db.close()


def create_all() -> None:
    """Create tables (used by tests and as a safety net alongside Alembic)."""
    from . import models  # noqa: F401

    get_engine()
    from sqlalchemy.orm import declarative_base

    from .models import Base

    Base.metadata.create_all(_engine)


def db_ok() -> bool:
    try:
        with get_engine().connect() as conn:
            conn.execute(text("SELECT 1"))
        return True
    except Exception:  # noqa: BLE001
        return False


def database_exists_with_tables() -> bool:
    try:
        insp = inspect(get_engine())
        return insp.has_table("users")
    except Exception:  # noqa: BLE001
        return False
