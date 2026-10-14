"""Creates ONLY the first administrator, from environment variables.

Usage:  ADMIN_EMAIL=... ADMIN_PASSWORD=... python -m scripts.seed_admin

Does nothing if an admin with that email already exists. No demo users or data are created.
"""

import os
import sys

from pydantic import EmailStr, TypeAdapter, ValidationError
from sqlalchemy import select

from app.audit import audit
from app.config import get_settings
from app.db import Base, SessionLocal, engine
from app.models import User
from app.security import hash_password
from app.schemas import _check_password


def main() -> int:
    s = get_settings()
    email = (s.admin_email or os.environ.get("ADMIN_EMAIL") or "").strip().lower()
    password = s.admin_password or os.environ.get("ADMIN_PASSWORD") or ""
    name = s.admin_name
    if not email or not password:
        print("ADMIN_EMAIL and ADMIN_PASSWORD must be set. Nothing created.", file=sys.stderr)
        return 1
    try:
        TypeAdapter(EmailStr).validate_python(email)  # same rules the login endpoint uses
    except ValidationError:
        print(f"ADMIN_EMAIL '{email}' is not accepted by the login validator. Use a real domain. Nothing created.", file=sys.stderr)
        return 1
    _check_password(password)
    Base.metadata.create_all(bind=engine)  # no-op if migrations already applied
    with SessionLocal() as db:
        existing = db.scalar(select(User).where(User.email == email))
        if existing:
            if existing.role != "admin":
                existing.role = "admin"
                audit(db, "admin.bootstrap_promote", actor_id=None, target=existing.id)
                db.commit()
                print(f"Existing user {email} promoted to admin.")
            else:
                print(f"Admin {email} already exists. Nothing changed.")
            return 0
        user = User(email=email, name=name, password_hash=hash_password(password), role="admin",
                    email_verified=True, plan="studio")
        db.add(user)
        db.flush()
        audit(db, "admin.bootstrap_create", actor_id=None, target=user.id)
        db.commit()
        print(f"First admin created: {email}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
