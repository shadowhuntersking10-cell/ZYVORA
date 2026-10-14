from sqlalchemy import select

from app.db import SessionLocal
from app.models import AuditLog, User
from tests.conftest import auth_header, login, make_user, register_user

ADMIN_ENDPOINTS = [
    ("get", "/api/admin/stats"),
    ("get", "/api/admin/users"),
    ("get", "/api/admin/audit"),
    ("get", "/api/admin/jobs"),
    ("get", "/api/admin/providers"),
    ("get", "/api/admin/system"),
    ("get", "/api/admin/payments"),
]


def test_admin_endpoints_reject_anonymous_with_401(client):
    for method, path in ADMIN_ENDPOINTS:
        assert getattr(client, method)(path).status_code == 401, path


def test_normal_users_get_403_on_every_admin_endpoint(client, user_token):
    for method, path in ADMIN_ENDPOINTS:
        r = getattr(client, method)(path, headers=auth_header(user_token))
        assert r.status_code == 403, path


def test_normal_user_cannot_block_or_change_roles(client, user_token):
    other = make_user(client, "victim@example.com")
    with SessionLocal() as db:
        vid = db.query(User).filter(User.email == "victim@example.com").one().id
    h = auth_header(user_token)
    assert client.post(f"/api/admin/users/{vid}/block", headers=h,
                       json={"blocked": True}).status_code == 403
    assert client.patch(f"/api/admin/users/{vid}", headers=h, json={"role": "admin"}).status_code == 403
    assert client.post(f"/api/admin/users/{vid}/credits", headers=h,
                       json={"delta": 100, "reason": "hack attempt"}).status_code == 403


def test_stats_are_real_counts_and_zero_when_empty(client, admin_token):
    r = client.get("/api/admin/stats", headers=auth_header(admin_token))
    body = r.json()
    assert body["users_total"] == 1  # only the admin exists
    assert body["projects_total"] == 0
    assert body["confirmed_payments"] == 0
    assert body["payments_gateway"]["connected"] is False


def test_admin_blocks_user_and_block_revokes_sessions(client, admin_token):
    register_user(client, "bad@example.com")
    bad_token = login(client, "bad@example.com")
    with SessionLocal() as db:
        bid = db.query(User).filter(User.email == "bad@example.com").one().id
    h = auth_header(admin_token)
    assert client.post(f"/api/admin/users/{bid}/block", headers=h,
                       json={"blocked": True, "reason": "spam"}).status_code == 200
    assert client.get("/api/auth/me", headers=auth_header(bad_token)).status_code == 403
    assert client.post("/api/auth/login", json={"email": "bad@example.com",
                                                "password": "Sup3rSecret-pass"}).status_code == 403
    assert client.post(f"/api/admin/users/{bid}/block", headers=h,
                       json={"blocked": False}).status_code == 200
    login(client, "bad@example.com")


def test_admin_cannot_block_self_and_last_admin_is_protected(client, admin_token):
    with SessionLocal() as db:
        aid = db.query(User).filter(User.email == "admin@example.com").one().id
    h = auth_header(admin_token)
    assert client.post(f"/api/admin/users/{aid}/block", headers=h,
                       json={"blocked": True}).status_code == 409
    assert client.patch(f"/api/admin/users/{aid}", headers=h, json={"role": "user"}).status_code == 409


def test_credit_adjustment_writes_ledger_and_audit(client, admin_token):
    register_user(client, "credit@example.com")
    with SessionLocal() as db:
        uid = db.query(User).filter(User.email == "credit@example.com").one().id
    h = auth_header(admin_token)
    r = client.post(f"/api/admin/users/{uid}/credits", headers=h,
                    json={"delta": 250, "reason": "welcome grant"})
    assert r.status_code == 200 and r.json()["credit_balance"] == 250
    detail = client.get(f"/api/admin/users/{uid}", headers=h).json()
    assert detail["credit_ledger"][0]["delta"] == 250
    with SessionLocal() as db:
        actions = [a.action for a in db.scalars(select(AuditLog))]
    assert "admin.credits_adjust" in actions


def test_admin_cannot_drive_balance_negative(client, admin_token):
    register_user(client, "poor@example.com")
    with SessionLocal() as db:
        uid = db.query(User).filter(User.email == "poor@example.com").one().id
    r = client.post(f"/api/admin/users/{uid}/credits", headers=auth_header(admin_token),
                    json={"delta": -10, "reason": "should fail"})
    assert r.status_code == 402


def test_payments_are_not_shown_as_working_without_gateway(client, admin_token):
    body = client.get("/api/admin/payments", headers=auth_header(admin_token)).json()
    assert body["gateway"]["connected"] is False
    assert body["orders"] == [] and body["subscriptions"] == []
