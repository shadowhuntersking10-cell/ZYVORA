"""Admin API: RBAC, audit trail, providers, settings."""
from tests.conftest import tg_init_data


def admin_headers(client):
    return {"X-Telegram-Init-Data": tg_init_data(user={"id": 111111, "first_name": "Boss", "language_code": "en"})}


def test_user_cannot_access_admin(auth):
    for path in ("/api/admin/overview", "/api/admin/users", "/api/admin/audit"):
        assert auth.client.get(path).status_code == 403, path
    assert auth.post("/api/admin/users/1/ban", json={}).status_code == 403


def test_admin_overview_real_numbers(client):
    h = admin_headers(client)
    r = client.get("/api/admin/overview", headers=h)
    assert r.status_code == 200
    data = r.json()
    assert data["users"]["total"] >= 1
    assert data["revenue"]["available"] is False, "revenue must be honest: not configured"


def test_moderator_read_only(client, auth):
    # create a moderator
    import time

    from app.models import User

    from app.db import session_factory

    s = session_factory()()
    email = f"mod{time.time_ns()}@test.io"
    s.add(User(full_name="Mod", email=email, password_hash=None, role="moderator"))
    s.commit()
    mod_id = s.query(User).filter_by(email=email).first().id
    s.close()

    # login as moderator is impossible without password; use direct session via password
    from app.security import hash_password

    s = session_factory()()
    u = s.get(User, mod_id)
    u.password_hash = hash_password("ModPass!123")
    s.commit()
    s.close()

    client.cookies.clear()  # fresh browser (no leftover session -> CSRF applies)
    r = client.post("/api/auth/login", json={"email": email, "password": "ModPass!123"})
    assert r.status_code == 200
    csrf = client.get("/api/me").json()["csrf"]
    h = {"X-CSRF-Token": csrf}

    # can read
    assert client.get("/api/admin/overview", headers=h).status_code == 200
    assert client.get("/api/admin/users", headers=h).status_code == 200
    # cannot mutate
    r = client.post(f"/api/admin/users/{auth.user['id']}/ban", headers=h, json={"reason": "x"})
    assert r.status_code == 403
    r = client.post("/api/admin/broadcast", headers=h, json={"text": "hi"})
    assert r.status_code == 403


def test_ban_unban_and_audit(client, auth):
    h = admin_headers(client)
    uid = auth.user["id"]
    r = client.post(f"/api/admin/users/{uid}/ban", headers=h, json={"reason": "test ban"})
    assert r.status_code == 200
    # banned user's session is revoked
    assert auth.client.get("/api/me").status_code == 401
    # unban
    assert client.post(f"/api/admin/users/{uid}/unban", headers=h).status_code == 200

    # audit log contains both
    r = client.get("/api/admin/audit", headers=h)
    actions = [e["action"] for e in r.json()["items"]]
    assert "admin.ban" in actions
    assert "admin.unban" in actions


def test_role_change_protections(client, auth):
    h = admin_headers(client)
    uid = auth.user["id"]
    r = client.post(f"/api/admin/users/{uid}/role", headers=h, json={"role": "moderator"})
    assert r.status_code == 200
    r = client.post(f"/api/admin/users/{uid}/role", headers=h, json={"role": "hacker"})
    assert r.status_code == 400
    # env-protected admin cannot be demoted
    r = client.get("/api/admin/users?q=111111", headers=h)
    boss = [u for u in r.json()["items"] if u["telegram_id"] == 111111]
    assert boss, "env admin must exist"
    r = client.post(f"/api/admin/users/{boss[0]['id']}/role", headers=h, json={"role": "user"})
    assert r.status_code == 400


def test_provider_toggle_and_test(client):
    h = admin_headers(client)
    r = client.get("/api/admin/providers", headers=h)
    names = [p["name"] for p in r.json()["items"]]
    assert {"openai", "stability", "meshy", "runway"} <= set(names)
    # honest configured=false in test env
    openai = [p for p in r.json()["items"] if p["name"] == "openai"][0]
    assert openai["configured"] is False

    r = client.post("/api/admin/providers/openai/toggle", headers=h)
    assert r.json()["enabled"] is False
    r = client.post("/api/admin/providers/openai/toggle", headers=h)
    assert r.json()["enabled"] is True

    r = client.post("/api/admin/providers/openai/test", headers=h)
    assert r.status_code == 200
    assert r.json()["ok"] is False  # no key -> honest failure


def test_settings_pricing(client):
    h = admin_headers(client)
    r = client.put("/api/admin/settings", headers=h, json={"image": 12})
    assert r.status_code == 200
    assert r.json()["pricing"]["image"] == 12
    r = client.get("/api/admin/settings", headers=h)
    assert r.json()["pricing"]["image"] == 12
    # restore
    client.put("/api/admin/settings", headers=h, json={"image": 5})
    # invalid value rejected
    r = client.put("/api/admin/settings", headers=h, json={"image": -1})
    assert r.status_code == 400


def test_status_endpoint(client):
    h = admin_headers(client)
    r = client.get("/api/admin/status", headers=h)
    data = r.json()
    assert data["database"]["ok"] is True
    assert data["bot"]["has_token"] is True
    assert "uptime_s" in data
