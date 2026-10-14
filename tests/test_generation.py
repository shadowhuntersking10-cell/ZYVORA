"""Generation jobs: honest failures without providers, fake-provider success,
quota/credit checks, idempotency, cost confirmation."""
import pytest


def test_submit_requires_cost_confirmation(auth):
    r = auth.post("/api/gen", json={"kind": "image", "prompt": "a blue cube city", "confirm_cost": False})
    assert r.status_code == 402
    assert r.json()["needs_confirm"] is True
    assert r.json()["cost"] == 5


def test_no_provider_fails_honestly_and_refunds(auth, db_session):
    # no AI keys in test env -> job must fail with an honest message and refund credits
    before = auth.me["user"]["credits"]
    r = auth.post("/api/gen", json={"kind": "image", "prompt": "test prompt here", "confirm_cost": True})
    assert r.status_code == 200
    job_id = r.json()["job"]["id"]

    from app.db import session_factory
    from app.services.generation import run_job_sync

    run_job_sync(session_factory, job_id)

    r = auth.client.get(f"/api/gen/{job_id}")
    job = r.json()["job"]
    assert job["status"] == "failed"
    assert "no provider configured" in (job["error"] or "").lower()
    # refunded
    auth.refresh()
    assert auth.me["user"]["credits"] == before


def test_job_lifecycle_with_fake_provider(auth, db_session, monkeypatch):
    from app.db import session_factory
    from app.services import generation as gen_svc
    from app.services.generation import run_job_sync
    from app.services.providers import BaseAdapter

    class FakeAdapter(BaseAdapter):
        name = "fake"
        label = "Fake"
        kinds = ("image",)

        @property
        def configured(self):
            return True

        def submit(self, kind, prompt, params):
            return {"status": "completed", "result": {"image_bytes": b"\x89PNG\r\n\x1a\n" + b"0" * 64}, "meta": {"provider": "fake"}}

    monkeypatch.setattr(gen_svc, "pick_provider", lambda db, kind: (FakeAdapter(), None))

    before = auth.me["user"]["credits"]
    r = auth.post("/api/gen", json={"kind": "image", "prompt": "a nice painting", "confirm_cost": True})
    assert r.status_code == 200
    job_id = r.json()["job"]["id"]

    run_job_sync(session_factory, job_id)

    r = auth.client.get(f"/api/gen/{job_id}")
    job = r.json()["job"]
    assert job["status"] == "completed"
    assert job["result_meta"]["file"], "image must be stored"
    # charged exactly once
    auth.refresh()
    assert auth.me["user"]["credits"] == before - 5
    # usage recorded
    from app.models import UsageRecord

    s = session_factory()()
    rec = s.query(UsageRecord).filter(UsageRecord.job_id == job_id).first()
    assert rec is not None
    assert rec.credits_used == 5
    s.close()


def test_idempotency_key_reuses_job(auth):
    r1 = auth.post("/api/gen", json={"kind": "text", "prompt": "hello world", "confirm_cost": True, "idempotency_key": "abc"})
    assert r1.status_code == 200
    r2 = auth.post("/api/gen", json={"kind": "text", "prompt": "hello world", "confirm_cost": True, "idempotency_key": "abc"})
    assert r2.status_code == 200
    assert r1.json()["job"]["id"] == r2.json()["job"]["id"]


def test_insufficient_credits_rejected(auth, db_session):
    from app.models import User

    s = session = db_session
    user = s.get(User, auth.user["id"])
    user.credits = 1
    s.commit()
    r = auth.post("/api/gen", json={"kind": "video", "prompt": "expensive video here", "confirm_cost": True})
    assert r.status_code == 402
    user.credits = 50
    s.commit()


def test_text_job_with_openai_key(monkeypatch, auth, db_session):
    """Adapter-level test with a stubbed HTTP call (no network in sandbox)."""
    from app.services.providers import OpenAIAdapter

    class FakeResp:
        status = 200
        data = {"choices": [{"message": {"content": "Hello!"}}], "model": "gpt-test"}

    from app.services import providers

    monkeypatch.setattr(providers, "_http_json", lambda *a, **kw: (200, FakeResp.data))
    adapter = OpenAIAdapter()
    adapter.settings.openai_api_key = "sk-test"
    out = adapter.submit("text", "hi", {})
    assert out["result"]["text"] == "Hello!"


def test_pricing_roundtrip(db_session):
    from app.services.generation import get_pricing, set_pricing

    set_pricing(db_session, {"image": 7})
    assert get_pricing(db_session)["image"] == 7
    assert get_pricing(db_session)["video"] == 40  # untouched default
    set_pricing(db_session, {"image": 5})
