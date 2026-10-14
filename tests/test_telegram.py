"""Telegram initData validation and WebApp auth."""
import pytest

from tests.conftest import tg_init_data


def test_validate_init_data_ok():
    from app.security import validate_init_data

    data = validate_init_data(tg_init_data(), "123456:TEST_TOKEN")
    assert data["user"]["id"] == 424242


def test_validate_init_data_tampered():
    from app.security import validate_init_data

    raw = tg_init_data()
    bad = raw.replace("query_id", "query_xx")
    with pytest.raises(ValueError):
        validate_init_data(bad, "123456:TEST_TOKEN")


def test_validate_init_data_wrong_token():
    from app.security import validate_init_data

    with pytest.raises(ValueError):
        validate_init_data(tg_init_data(), "999999:OTHER_TOKEN")


def test_validate_init_data_expired():
    from app.security import validate_init_data

    with pytest.raises(ValueError):
        validate_init_data(tg_init_data(age=200000), "123456:TEST_TOKEN")


def test_webapp_auth_creates_user(tg_client):
    r = tg_client.get("/api/me")
    assert r.status_code == 200
    me = r.json()
    assert me["user"]["telegram_id"] == 424242
    assert me["user"]["lang"] == "uz"
    # welcome credits
    assert me["user"]["credits"] == 50


def test_admin_promotion_by_env_id(client):
    from tests.conftest import tg_init_data

    headers = {"X-Telegram-Init-Data": tg_init_data(user={"id": 111111, "first_name": "Boss", "language_code": "ru"})}
    me = client.get("/api/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["user"]["role"] == "admin"
    # admin panel access works
    assert client.get("/api/admin/overview", headers=headers).status_code == 200


def test_banned_tg_user_blocked(client, db_session):
    from tests.conftest import tg_init_data

    from app.models import User

    headers = {"X-Telegram-Init-Data": tg_init_data(user={"id": 555555, "first_name": "Bad"})}
    assert client.get("/api/me", headers=headers).status_code == 200
    u = db_session.query(User).filter_by(telegram_id=555555).first()
    u.is_banned = True
    u.ban_reason = "spam"
    db_session.commit()
    r = client.get("/api/me", headers=headers)
    assert r.status_code == 403
    assert "spam" in r.json()["detail"].lower()


def test_bot_ensure_user_creates_and_grants(db_session):
    from app.bot.handlers import _ensure_user
    from app.models import User

    user = _ensure_user(777777, "botuser", "Bot", "User", "en")
    assert user.id is not None
    fresh = db_session.query(User).filter_by(telegram_id=777777).first()
    assert fresh.lang == "en"
    assert fresh.bot_started is True
    assert fresh.credits == 50

    again = _ensure_user(777777, "botuser", "Bot", "User", "en")
    db_session.expire_all()
    fresh = db_session.query(User).filter_by(telegram_id=777777).first()
    assert fresh.credits == 50, "welcome credits must be granted only once"
