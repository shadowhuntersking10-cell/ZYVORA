"""Shared pytest fixtures. Env is configured BEFORE app imports."""
from __future__ import annotations

import hashlib
import hmac
import os
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_TMP = tempfile.mkdtemp(prefix="zyvora_test_")
os.environ.update(
    DATABASE_URL=f"sqlite:///{_TMP}/test.db",
    BOT_TOKEN="123456:TEST_TOKEN",
    BOT_USERNAME="test_bot",
    ZYVORA_ADMIN_IDS="111111",
    ZYVORA_SECRET_KEY="x" * 48,
    ZYVORA_DEBUG="1",
    ZYVORA_DATA_DIR=_TMP,
    ZYVORA_DEV_WEBAPP_BYPASS="0",
    ZYVORA_WELCOME_CREDITS="50",
)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import set_settings, Settings  # noqa: E402
from app.db import create_all, init_engine, session_factory  # noqa: E402
from app.ratelimit import reset_for_tests  # noqa: E402
from app.web.server import create_app  # noqa: E402


@pytest.fixture(scope="session", autouse=True)
def _db():
    set_settings(Settings())
    init_engine(echo=False)
    create_all()
    yield


@pytest.fixture(autouse=True)
def _fresh_limits():
    reset_for_tests()
    yield


@pytest.fixture()
def db_session():
    s = session_factory()()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture()
def client():
    """TestClient without lifespan (no bot/worker background tasks)."""
    return TestClient(create_app())


@pytest.fixture()
def fresh_client():
    """A second, cookie-isolated client (for multi-user scenarios)."""
    return TestClient(create_app())


def make_csrf(client: TestClient) -> dict:
    """Login a fresh user; returns {headers} with CSRF."""
    email = f"user{time.time_ns()}@test.io"
    r = client.post("/api/auth/register", json={"name": "Test User", "email": email, "password": "Str0ngPass!1", "password2": "Str0ngPass!1", "lang": "uz"})
    assert r.status_code == 200, r.text
    me = client.get("/api/me").json()
    return {"X-CSRF-Token": me["csrf"], "email": email}


@pytest.fixture()
def auth(client):
    """Authenticated TestClient (cookies set) with csrf headers helper."""
    class Auth:
        def __init__(self):
            self.client = client
            email = f"user{time.time_ns()}@test.io"
            r = client.post("/api/auth/register", json={
                "name": "Test User", "email": email,
                "password": "Str0ngPass!1", "password2": "Str0ngPass!1", "lang": "uz",
            })
            assert r.status_code == 200, r.text
            self.email = email
            self.refresh()

        def refresh(self):
            me = self.client.get("/api/me").json()
            self.user = me["user"]
            self.csrf = me["csrf"]
            self.me = me
            return me

        def post(self, path, **kw):
            return self.client.post(path, headers={"X-CSRF-Token": self.csrf}, **kw)

        def put(self, path, **kw):
            return self.client.put(path, headers={"X-CSRF-Token": self.csrf}, **kw)

        def patch(self, path, **kw):
            return self.client.patch(path, headers={"X-CSRF-Token": self.csrf}, **kw)

        def delete(self, path, **kw):
            return self.client.delete(path, headers={"X-CSRF-Token": self.csrf}, **kw)

    return Auth()


def tg_init_data(bot_token: str = "123456:TEST_TOKEN", user: dict | None = None, age: int = 0) -> str:
    """Build properly signed Telegram WebApp initData for tests."""
    import json as _json
    from urllib.parse import quote

    user = user or {"id": 424242, "first_name": "Tg", "username": "tguser", "language_code": "uz"}
    params = {
        "auth_date": str(int(time.time()) - age),
        "query_id": "AAF_test",
        "user": _json.dumps(user),
    }
    data_check_string = "\n".join(f"{k}={params[k]}" for k in sorted(params))
    secret = hmac.new(b"WebAppData", bot_token.encode(), hashlib.sha256).digest()
    sig = hmac.new(secret, data_check_string.encode(), hashlib.sha256).hexdigest()
    return "&".join(f"{k}={quote(str(v), safe='')}" for k, v in params.items()) + f"&hash={sig}"


@pytest.fixture()
def tg_client(client):
    """Client authenticated as a Telegram WebApp user (id 424242)."""
    class TgAuth:
        def __init__(self):
            self.client = client
            self.data = tg_init_data()
            self.headers = {"X-Telegram-Init-Data": self.data}

        def get(self, path):
            return self.client.get(path, headers=self.headers)

        def post(self, path, **kw):
            return self.client.post(path, headers=self.headers, **kw)

    return TgAuth()
