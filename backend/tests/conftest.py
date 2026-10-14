import os
import tempfile

# Must be set before the app modules are imported.
_tmp = tempfile.mkdtemp(prefix="zyvora-test-")
os.environ["DATABASE_URL"] = f"sqlite:///{_tmp}/test.db"
os.environ["ENVIRONMENT"] = "development"
os.environ["JWT_SECRET"] = "test-secret-test-secret-test-secret-123"
os.environ["RATE_LIMIT_PER_MINUTE"] = "1000"
os.environ["OPENAI_API_KEY"] = ""
os.environ["MESHY_API_KEY"] = ""
os.environ["TRIPO_API_KEY"] = ""
os.environ["STABILITY_API_KEY"] = ""
os.environ["VIDEO_PROVIDER_API_KEY"] = ""
os.environ["AUDIO_PROVIDER_API_KEY"] = ""
os.environ.pop("STRIPE_SECRET_KEY", None)

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import Base, SessionLocal, engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models import User  # noqa: E402
from app.ratelimit import reset_rate_limits  # noqa: E402
from app.security import hash_password  # noqa: E402

PASSWORD = "Sup3rSecret-pass"


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    reset_rate_limits()
    yield


@pytest.fixture()
def client():
    app = create_app()
    with TestClient(app) as c:
        yield c


def register_user(client: TestClient, email: str, name: str = "Test User") -> dict:
    r = client.post("/api/auth/register", json={"name": name, "email": email, "password": PASSWORD})
    assert r.status_code == 201, r.text
    return r.json()


def login(client: TestClient, email: str) -> str:
    r = client.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def auth_header(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


def make_user(client: TestClient, email: str, role: str = "user") -> str:
    register_user(client, email)
    with SessionLocal() as db:
        u = db.query(User).filter(User.email == email).one()
        if role == "admin":
            u.role = "admin"
        db.commit()
    return login(client, email)


@pytest.fixture()
def user_token(client):
    return make_user(client, "user@example.com")


@pytest.fixture()
def admin_token(client):
    return make_user(client, "admin@example.com", role="admin")


@pytest.fixture()
def settings():
    return get_settings()
