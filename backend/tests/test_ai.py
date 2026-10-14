from app.ai.providers import ProviderResult, get_adapter
from app.db import SessionLocal
from app.models import CreditLedger, User
from tests.conftest import auth_header

RUN = {"provider": "openai", "task": "chat", "prompt": "make him run", "units": 1, "confirmed": True}


def _grant(user_email: str, amount: int):
    with SessionLocal() as db:
        u = db.query(User).filter(User.email == user_email).one()
        u.credit_balance = amount
        db.commit()


def _balance(email: str) -> int:
    with SessionLocal() as db:
        return db.query(User).filter(User.email == email).one().credit_balance


def test_missing_key_reports_provider_not_connected_and_charges_nothing(client, user_token):
    _grant("user@example.com", 100)
    r = client.post("/api/ai/run", headers=auth_header(user_token), json=RUN)
    assert r.status_code == 503
    assert r.json()["detail"]["message"] == "provider not connected"
    assert _balance("user@example.com") == 100


def test_status_lists_all_providers_without_exposing_keys(client, user_token):
    body = client.get("/api/ai/providers", headers=auth_header(user_token)).json()
    names = {p["provider"] for p in body}
    assert names == {"openai", "meshy", "tripo", "stability", "video", "audio"}
    assert all(p["connected"] is False for p in body)
    assert "api_key" not in str(body)


def test_estimate_requires_confirmation_and_shows_cost(client, user_token):
    r = client.post("/api/ai/estimate", headers=auth_header(user_token),
                    json={"provider": "meshy", "task": "text_to_3d", "units": 2})
    body = r.json()
    assert body["cost_credits"] == 80
    assert body["requires_confirmation"] is True
    assert body["provider_connected"] is False


def test_run_without_confirmation_is_rejected(client, user_token, monkeypatch):
    _grant("user@example.com", 100)
    adapter = get_adapter("openai")
    monkeypatch.setattr(adapter, "is_connected", lambda: True)
    r = client.post("/api/ai/run", headers=auth_header(user_token), json={**RUN, "confirmed": False})
    assert r.status_code == 400
    assert _balance("user@example.com") == 100


def test_run_without_enough_credits_is_402(client, user_token, monkeypatch):
    adapter = get_adapter("meshy")
    monkeypatch.setattr(adapter, "is_connected", lambda: True)
    r = client.post("/api/ai/run", headers=auth_header(user_token),
                    json={"provider": "meshy", "task": "text_to_3d", "prompt": "a cube", "units": 1,
                          "confirmed": True})
    assert r.status_code == 402


def test_successful_run_charges_and_logs_ledger(client, user_token, monkeypatch):
    _grant("user@example.com", 100)
    adapter = get_adapter("openai")
    monkeypatch.setattr(adapter, "is_connected", lambda: True)
    monkeypatch.setattr(adapter, "run", lambda task, prompt, units: ProviderResult(
        status="succeeded", output={"text": "Ready"}))
    r = client.post("/api/ai/run", headers=auth_header(user_token), json=RUN)
    assert r.status_code == 201 and r.json()["status"] == "succeeded"
    assert _balance("user@example.com") == 99
    with SessionLocal() as db:
        assert db.query(CreditLedger).count() == 1  # exactly one charge entry
        assert any(e.delta == -1 for e in db.query(CreditLedger).all())


def test_provider_failure_refunds_credits(client, user_token, monkeypatch):
    _grant("user@example.com", 100)
    adapter = get_adapter("openai")
    monkeypatch.setattr(adapter, "is_connected", lambda: True)
    monkeypatch.setattr(adapter, "run", lambda task, prompt, units: ProviderResult(
        status="failed", error="upstream 500"))
    r = client.post("/api/ai/run", headers=auth_header(user_token), json=RUN)
    assert r.status_code == 201
    body = r.json()
    assert body["status"] == "failed" and body["charged_credits"] == 0
    assert _balance("user@example.com") == 100
    with SessionLocal() as db:
        reasons = [e.reason for e in db.query(CreditLedger).all()]
    assert "ai.refund.provider_failure" in reasons


def test_async_job_is_polled_and_refunded_on_failure(client, user_token, monkeypatch):
    _grant("user@example.com", 100)
    adapter = get_adapter("meshy")
    monkeypatch.setattr(adapter, "is_connected", lambda: True)
    monkeypatch.setattr(adapter, "run", lambda task, prompt, units: ProviderResult(
        status="running", output={"provider_task_id": "task-1"}))
    body = client.post("/api/ai/run", headers=auth_header(user_token),
                       json={"provider": "meshy", "task": "text_to_3d", "prompt": "a cube", "units": 1,
                             "confirmed": True}).json()
    assert body["status"] == "running"
    assert _balance("user@example.com") == 60
    monkeypatch.setattr(adapter, "poll", lambda tid: ProviderResult(status="failed", error="FAILED"))
    job = client.get(f"/api/ai/jobs/{body['id']}", headers=auth_header(user_token)).json()
    assert job["status"] == "failed"
    assert _balance("user@example.com") == 100


def test_users_cannot_read_other_users_jobs(client, user_token, admin_token, monkeypatch):
    _grant("user@example.com", 100)
    adapter = get_adapter("openai")
    monkeypatch.setattr(adapter, "is_connected", lambda: True)
    monkeypatch.setattr(adapter, "run", lambda task, prompt, units: ProviderResult(status="succeeded", output={}))
    jid = client.post("/api/ai/run", headers=auth_header(user_token), json=RUN).json()["id"]
    assert client.get(f"/api/ai/jobs/{jid}", headers=auth_header(admin_token)).status_code == 404
