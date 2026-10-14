"""Authentication & account flows."""
from tests.conftest import make_csrf


def test_register_login_logout(client):
    r = client.post("/api/auth/register", json={
        "name": "Ali Valiyev", "email": "ali@test.io",
        "password": "Str0ngPass!1", "password2": "Str0ngPass!1", "lang": "uz",
    })
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data["user"]["email"] == "ali@test.io"
    assert data["user"]["role"] == "user"
    assert data["user"]["password_hash" if "password_hash" in data["user"] else "credits"] is not None

    # session persists
    me = client.get("/api/me")
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "ali@test.io"

    # welcome credits granted exactly once
    assert me.json()["user"]["credits"] == 50

    # logout
    csrf = me.json()["csrf"]
    r = client.post("/api/auth/logout", headers={"X-CSRF-Token": csrf})
    assert r.status_code == 200
    assert client.get("/api/me").status_code == 401


def test_duplicate_email_rejected(client):
    body = {"name": "First", "email": "dup@test.io", "password": "Str0ngPass!1", "password2": "Str0ngPass!1", "lang": "uz"}
    assert client.post("/api/auth/register", json=body).status_code == 200
    r = client.post("/api/auth/register", json={**body, "name": "Second"})
    assert r.status_code == 409
    assert "already" in r.json()["error"].lower() or "ro'yxat" in r.json()["error"].lower()


def test_password_validation(client):
    base = {"name": "Val", "email": "pw@test.io", "lang": "en"}
    r = client.post("/api/auth/register", json={**base, "password": "short", "password2": "short"})
    assert r.status_code == 400
    r = client.post("/api/auth/register", json={**base, "password": "Str0ngPass!1", "password2": "Different1!"})
    assert r.status_code == 400
    r = client.post("/api/auth/register", json={**base, "password": "Str0ngPass!1", "password2": "Str0ngPass!1", "name": "V"})
    assert r.status_code == 400  # name too short


def test_login_wrong_password(client):
    client.post("/api/auth/register", json={
        "name": "Hacker Test", "email": "login@test.io",
        "password": "Str0ngPass!1", "password2": "Str0ngPass!1", "lang": "uz",
    })
    r = client.post("/api/auth/login", json={"email": "login@test.io", "password": "wrong-pass"})
    assert r.status_code == 401
    r = client.post("/api/auth/login", json={"email": "nosuch@test.io", "password": "wrong-pass"})
    assert r.status_code == 401


def test_protected_endpoint_requires_auth(client):
    assert client.get("/api/me").status_code == 401
    assert client.get("/api/projects").status_code == 401


def test_csrf_enforced(client):
    h = make_csrf(client)
    # mutating request without CSRF token is rejected
    r = client.post("/api/projects", json={"name": "x", "kind": "2d"})
    assert r.status_code == 403
    # with token it works
    r = client.post("/api/projects", json={"name": "x", "kind": "2d"}, headers={"X-CSRF-Token": h["X-CSRF-Token"]})
    assert r.status_code == 200


def test_change_password(client, auth):
    r = auth.post("/api/me/password", json={"old_password": "wrong", "new_password": "NewStr0ng!22"})
    assert r.status_code == 403
    r = auth.post("/api/me/password", json={"old_password": "Str0ngPass!1", "new_password": "NewStr0ng!22"})
    assert r.status_code == 200
    # old password no longer works, new one does
    r = auth.client.post("/api/auth/login", json={"email": auth.email, "password": "Str0ngPass!1"})
    assert r.status_code == 401
    r = auth.client.post("/api/auth/login", json={"email": auth.email, "password": "NewStr0ng!22"})
    assert r.status_code == 200


def test_password_reset_flow(client, auth):
    r = client.post("/api/auth/forgot", json={"email": auth.email})
    assert r.status_code == 200
    data = r.json()
    assert data["ok"] is True
    assert data.get("dev_link"), "DEBUG mode must expose the reset link (SMTP not configured)"
    token = data["dev_link"].split("token=")[1]

    r = client.post("/api/auth/reset", json={"token": token, "password": "ResetPass!23", "password2": "ResetPass!23"})
    assert r.status_code == 200
    assert client.post("/api/auth/login", json={"email": auth.email, "password": "Str0ngPass!1"}).status_code == 401
    assert client.post("/api/auth/login", json={"email": auth.email, "password": "ResetPass!23"}).status_code == 200

    # token reuse is blocked
    r = client.post("/api/auth/reset", json={"token": token, "password": "Another!111", "password2": "Another!111"})
    assert r.status_code == 400


def test_account_delete(client, auth):
    # create a project first
    auth.post("/api/projects", json={"name": "To be deleted", "kind": "2d"})
    r = auth.post("/api/me/delete", json={"password": "Str0ngPass!1"})
    assert r.status_code == 200
    # session revoked
    assert auth.client.get("/api/me").status_code == 401
    # login no longer possible (password cleared, banned)
    r = client.post("/api/auth/login", json={"email": auth.email, "password": "Str0ngPass!1"})
    assert r.status_code in (401, 403)
