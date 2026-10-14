def test_health_and_security_headers(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["x-frame-options"] == "DENY"


def test_seed_admin_creates_only_the_first_admin(client, monkeypatch):
    import os
    from sqlalchemy import select

    from app.db import SessionLocal
    from app.models import User
    from scripts import seed_admin
    from app.config import get_settings

    get_settings.cache_clear()
    monkeypatch.setenv("ADMIN_EMAIL", "root@example.com")
    monkeypatch.setenv("ADMIN_PASSWORD", "R00t-Account-pass")
    get_settings.cache_clear()
    assert seed_admin.main() == 0
    assert seed_admin.main() == 0  # idempotent
    with SessionLocal() as db:
        users = db.scalars(select(User)).all()
        assert len(users) == 1 and users[0].role == "admin"
    get_settings.cache_clear()
