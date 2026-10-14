"""Alembic migrations run cleanly on a fresh database."""
import os
import tempfile


def test_migrations_upgrade_downgrade():
    import sys
    from pathlib import Path

    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    tmp = tempfile.mkdtemp(prefix="zyvora_mig_")
    os.environ["MIG_TEST_URL"] = f"sqlite:///{tmp}/m.db"

    # Use a dedicated engine via direct alembic invocation
    from alembic import command
    from alembic.config import Config

    from app.models import Base  # ensure models imported

    cfg = Config("alembic.ini")
    cfg.set_main_option("sqlalchemy.url", os.environ["MIG_TEST_URL"])
    command.upgrade(cfg, "head")
    command.downgrade(cfg, "base")
    command.upgrade(cfg, "head")

    # tables exist
    import sqlite3

    con = sqlite3.connect(f"{tmp}/m.db")
    tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    con.close()
    expected = {"users", "projects", "gen_jobs", "credit_ledger", "audit_logs", "auth_sessions"}
    assert expected <= tables
