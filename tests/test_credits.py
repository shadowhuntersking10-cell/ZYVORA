"""Credit ledger: grants, reserve/refund, insufficiency, idempotent refunds."""
import pytest

from app.services import credits as credits_svc
from app.services.credits import CreditError


def test_welcome_grant(auth):
    assert auth.me["user"]["credits"] == 50
    reasons = [l["reason"] for l in auth.me["ledger"]]
    assert "welcome" in reasons


def test_grant_and_history(auth, db_session):
    from app.models import User

    user = db_session.get(User, auth.user["id"])
    bal = credits_svc.grant(db_session, user, 100, "admin_grant", ref_id="t1")
    assert bal == 150
    bal = credits_svc.grant(db_session, user, 25, "admin_grant", ref_id="t2")
    assert bal == 175
    hist = credits_svc.history(db_session, user.id)
    assert [h.delta for h in hist[:2]] == [25, 100]
    assert hist[0].balance_after == 175


def test_insufficient_reserve(auth, db_session):
    from app.models import User

    user = db_session.get(User, auth.user["id"])
    with pytest.raises(CreditError):
        credits_svc.reserve(db_session, user, 99999, "gen_reserve")


def test_refund_idempotent(auth, db_session):
    from app.models import User

    user = db_session.get(User, auth.user["id"])
    credits_svc.reserve(db_session, user, 10, "gen_reserve", ref_id="job:1")
    assert user.credits == 40
    credits_svc.refund(db_session, user, 10, "gen_refund", ref_id="job:1")
    assert user.credits == 50
    # duplicate refund ignored
    credits_svc.refund(db_session, user, 10, "gen_refund", ref_id="job:1")
    assert user.credits == 50


def test_admin_grant_endpoint(client, auth):
    # find admin via tg client id 111111
    from tests.conftest import tg_init_data

    headers = {"X-Telegram-Init-Data": tg_init_data(user={"id": 111111, "first_name": "Boss"})}
    r = client.post(f"/api/admin/users/{auth.user['id']}/credits", headers=headers, json={"amount": 200})
    assert r.status_code == 200
    assert r.json()["credits"] == 250

    r = client.post(f"/api/admin/users/{auth.user['id']}/credits", headers=headers, json={"amount": -5})
    assert r.status_code == 400
