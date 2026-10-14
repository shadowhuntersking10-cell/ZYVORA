"""Website pages and health endpoint."""


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ok"
    assert data["database"]["ok"] is True


def test_landing_contains_cta(client):
    r = client.get("/")
    assert r.status_code == 200
    assert "ZYVORA" in r.text


def test_login_page_renders(client):
    r = client.get("/login")
    assert r.status_code == 200
    assert "<form" in r.text


def test_register_page_renders(client):
    assert client.get("/register").status_code == 200
    assert client.get("/forgot-password").status_code == 200


def test_dashboard_redirects_anonymous(client):
    r = client.get("/dashboard", follow_redirects=False)
    assert r.status_code == 302
    assert "/login" in r.headers["location"]


def test_dashboard_renders_for_user(client, auth):
    r = auth.client.get("/dashboard")
    assert r.status_code == 200
    assert "appShell" in r.text


def test_webapp_page_renders(client):
    r = client.get("/app")
    assert r.status_code == 200
    assert "Telegram" in r.text or "telegram" in r.text.lower()


def test_static_css_served(client):
    r = client.get("/static/css/softui.css")
    assert r.status_code == 200
    assert "--accent" in r.text


def test_set_lang_cookie(client):
    r = client.get("/set-lang?lang=ru&next_url=/", follow_redirects=False)
    assert r.status_code == 302
    assert "zyvora_lang" in r.headers.get("set-cookie", "")


def test_verify_email_bad_token(client):
    r = client.get("/verify-email?token=nonexistent")
    assert r.status_code == 200
    assert "⚠️" in r.text
