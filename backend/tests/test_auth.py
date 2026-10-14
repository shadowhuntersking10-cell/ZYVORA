from tests.conftest import PASSWORD, auth_header, login, register_user


def test_register_creates_user_and_returns_safe_fields(client):
    body = register_user(client, "new@example.com", "New User")
    assert body["user"]["email"] == "new@example.com"
    assert body["user"]["role"] == "user"
    assert "password" not in str(body)
    assert body["email_delivery"] == "not_connected"


def test_duplicate_email_rejected(client):
    register_user(client, "dup@example.com")
    r = client.post("/api/auth/register", json={"name": "x", "email": "dup@example.com", "password": PASSWORD})
    assert r.status_code == 409


def test_weak_password_rejected(client):
    r = client.post("/api/auth/register", json={"name": "x", "email": "weak@example.com", "password": "short"})
    assert r.status_code == 422


def test_login_wrong_password_is_401(client):
    register_user(client, "a@example.com")
    r = client.post("/api/auth/login", json={"email": "a@example.com", "password": "Wrong-pass-123"})
    assert r.status_code == 401


def test_me_requires_token(client):
    assert client.get("/api/auth/me").status_code == 401
    token = login(client, _reg(client, "me@example.com"))
    r = client.get("/api/auth/me", headers=auth_header(token))
    assert r.status_code == 200 and r.json()["email"] == "me@example.com"


def _reg(client, email):
    register_user(client, email)
    return email


def test_refresh_rotates_cookie_and_logout_revokes(client):
    email = _reg(client, "r@example.com")
    login(client, email)
    old_cookie = client.cookies.get("zyvora_refresh")
    assert old_cookie
    r = client.post("/api/auth/refresh")
    assert r.status_code == 200
    new_cookie = client.cookies.get("zyvora_refresh")
    assert new_cookie and new_cookie != old_cookie
    # The old refresh token must no longer work.
    client.cookies.set("zyvora_refresh", old_cookie, path="/api/auth")
    assert client.post("/api/auth/refresh").status_code == 401
    client.cookies.set("zyvora_refresh", new_cookie, path="/api/auth")
    assert client.post("/api/auth/logout").status_code == 204
    client.cookies.set("zyvora_refresh", new_cookie, path="/api/auth")
    assert client.post("/api/auth/refresh").status_code == 401


def test_change_password_revokes_other_sessions(client):
    email = _reg(client, "pw@example.com")
    token = login(client, email)
    client.post("/api/auth/login", json={"email": email, "password": PASSWORD})  # second session
    r = client.post("/api/auth/me/password", headers=auth_header(token),
                    json={"current_password": PASSWORD, "new_password": "An0ther-Secret"})
    assert r.status_code == 204
    r = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 401
    r = client.post("/api/auth/login", json={"email": email, "password": "An0ther-Secret"})
    assert r.status_code == 200


def test_forgot_password_does_not_leak_existence(client):
    _reg(client, "f@example.com")
    a = client.post("/api/auth/forgot", json={"email": "f@example.com"})
    b = client.post("/api/auth/forgot", json={"email": "nobody@example.com"})
    assert a.status_code == b.status_code == 202
    assert a.json() == {"status": "accepted", "email_delivery": "not_connected"}
    assert b.json() == {"status": "accepted", "email_delivery": "not_connected"}


def test_delete_account_requires_password(client):
    email = _reg(client, "del@example.com")
    token = login(client, email)
    assert client.post("/api/auth/me/delete", headers=auth_header(token),
                       json={"password": "wrong-password-1"}).status_code == 400
    assert client.post("/api/auth/me/delete", headers=auth_header(token),
                       json={"password": PASSWORD}).status_code == 204
    assert client.get("/api/auth/me", headers=auth_header(token)).status_code == 401


def test_password_policy_requires_upper_lower_and_digit(client):
    for bad in ["alllowercase1", "ALLUPPERCASE1", "NoDigitsHere"]:
        r = client.post("/api/auth/register", json={"name": "x", "email": f"p{len(bad)}@example.com", "password": bad})
        assert r.status_code == 422, bad
    ok = client.post("/api/auth/register", json={"name": "x", "email": "okpolicy@example.com", "password": "Abcdef12"})
    assert ok.status_code == 201


def test_remember_me_off_gives_session_cookie(client):
    register_user(client, "rem@example.com")
    r = client.post("/api/auth/login", json={"email": "rem@example.com", "password": PASSWORD, "remember": False})
    assert r.status_code == 200
    assert "max-age" not in r.headers["set-cookie"].lower()
    r = client.post("/api/auth/login", json={"email": "rem@example.com", "password": PASSWORD, "remember": True})
    assert "max-age" in r.headers["set-cookie"].lower()


def test_resend_verification_is_generic_and_never_reveals_accounts(client):
    a = client.post("/api/auth/resend-verification", json={"email": "nobody@example.com"})
    register_user(client, "rv@example.com")
    b = client.post("/api/auth/resend-verification", json={"email": "rv@example.com"})
    assert a.status_code == b.status_code == 202
    assert a.json() == b.json() == {"status": "accepted", "email_delivery": "not_connected"}
