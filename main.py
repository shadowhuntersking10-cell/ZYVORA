#!/usr/bin/env python3
"""ZYVORA — single entrypoint.

Runs everything with one command:
    python main.py

Includes:
  * the website (landing, registration/login, user dashboard)
  * the Telegram WebApp + full API
  * the Telegram bot (polling) when BOT_TOKEN is set
  * MySQL database (auto-create + Alembic migrations) with an explicit,
    loud SQLite dev fallback
  * background AI generation worker
"""
from __future__ import annotations

import logging
import secrets
import sys

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
)
log = logging.getLogger("zyvora.main")

BANNER = r"""
 ███████╗██╗   ██╗██╗   ██╗ ██████╗ ██████╗  █████╗
 ╚══███╔╝╚██╗ ██╔╝██║   ██║██╔═══██╗██╔══██╗██╔══██╗
   ███╔╝  ╚████╔╝ ██║   ██║██║   ██║██████╔╝███████║
  ███╔╝    ╚██╔╝  ╚██╗ ██╔╝██║   ██║██╔══██╗██╔══██║
 ███████╗   ██║    ╚████╔╝ ╚██████╔╝██║  ██║██║  ██║
 ╚══════╝   ╚═╝     ╚═══╝   ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝
        AI Creative Studio — Website · WebApp · Bot
"""


def run_migrations() -> None:
    """Alembic upgrade head. Falls back to create_all with a loud warning."""
    try:
        from alembic import command
        from alembic.config import Config

        cfg = Config("alembic.ini")
        cfg.set_main_option("sqlalchemy.url", _migration_url())
        command.upgrade(cfg, "head")
        log.info("Alembic migrations applied (head).")
    except Exception as exc:  # noqa: BLE001
        log.warning("Alembic failed (%s) — using create_all fallback.", exc)
        from app.db import create_all

        create_all()
        log.info("create_all completed.")


def _migration_url() -> str:
    from app.config import get_settings
    from app.db import init_engine

    engine = init_engine()
    url = str(engine.url)
    if url.startswith("mysql"):
        url += ("&" if "?" in url else "?") + "charset=utf8mb4"
    return url


def seed_initial_data() -> None:
    """Idempotent bootstrap: pricing + initial website admin."""
    from app.config import get_settings
    from app.db import session_factory
    from app.models import User
    from app.services import credits as credits_svc
    from app.services.generation import get_pricing, set_pricing

    settings = get_settings()
    db = session_factory()()
    try:
        if "image" not in (get_pricing(db) or {}):
            set_pricing(db, {"image": 5, "video": 40, "3d": 25, "text": 1})

        if settings.admin_email:
            email = settings.admin_email.strip().lower()
            admin = db.query(User).filter(User.email == email).first()
            if admin is None:
                password = settings.admin_password or secrets.token_urlsafe(10)
                from app.security import hash_password

                admin = User(full_name="Administrator", email=email, password_hash=hash_password(password), role="admin", lang="uz", email_verified=True)
                db.add(admin)
                db.commit()
                credits_svc.grant(db, admin, max(settings.welcome_credits, 500), "welcome", ref_id="seed", notify_user=False)
                if settings.admin_password:
                    log.info("Initial admin created: %s", email)
                else:
                    log.info("Initial admin created: %s  password: %s  (change it after first login!)", email, password)
            elif admin.role != "admin":
                admin.role = "admin"
                db.commit()
                log.info("Existing user %s promoted to admin (ZYVORA_ADMIN_EMAIL).", email)
        else:
            count = db.query(User).filter(User.role == "admin").count()
            if count == 0:
                log.warning(
                    "No admin exists yet. Set ZYVORA_ADMIN_EMAIL + ZYVORA_ADMIN_PASSWORD, or add Telegram IDs to ZYVORA_ADMIN_IDS."
                )
    finally:
        db.close()


def main() -> None:
    from app.config import get_settings

    settings = get_settings()
    print(BANNER)
    log.info("App: %s v%s | debug=%s", settings.app_name, settings.version, settings.debug)
    for problem in settings.validate():
        log.warning("CONFIG: %s", problem)

    # 1) database
    from app.db import init_engine

    engine = init_engine()
    log.info("Database: %s", engine.url.render_as_string(hide_password=True))

    # 2) migrations
    run_migrations()

    # 3) seed
    seed_initial_data()

    # 4) web + bot + worker in one process
    import uvicorn

    from app.web.server import create_app

    app = create_app()
    uvicorn.run(app, host=settings.host, port=settings.port, log_level="info" if settings.debug else "warning")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nBye!")
        sys.exit(0)
