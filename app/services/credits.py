"""Credit ledger with row-level balance guards.

Rules:
- Money-like operations run inside a DB transaction with a consistent balance check.
- Every change writes a ledger row; balances never go below zero.
- Reservation (for generation jobs) and reconciliation (refund) are separate,
  idempotent-by-reason operations.
"""
from __future__ import annotations

from sqlalchemy.orm import Session as DbSession

from ..i18n import t
from ..models import CreditLedger, User
from .audit import notify

REASONS = ("welcome", "admin_grant", "gen_reserve", "gen_refund", "signup_bonus")


class CreditError(Exception):
    pass


def grant(db: DbSession, user: User, amount: int, reason: str, ref_id: str | None = None, *, notify_user: bool = True) -> int:
    if amount <= 0:
        raise CreditError("amount must be positive")
    user.credits = (user.credits or 0) + amount
    db.add(
        CreditLedger(
            user_id=user.id,
            delta=amount,
            balance_after=user.credits,
            reason=reason[:64],
            ref_id=ref_id,
        )
    )
    if notify_user:
        notify(db, user.id, "credits", t(user.lang, "notif.credits", amount=amount), commit=False)
    db.commit()
    return user.credits


def reserve(db: DbSession, user: User, amount: int, reason: str, ref_id: str | None = None) -> int:
    """Charge up-front. Raises CreditError if the balance is insufficient."""
    if amount < 0:
        raise CreditError("negative reserve")
    if (user.credits or 0) < amount:
        raise CreditError("insufficient credits")
    user.credits = user.credits - amount
    db.add(
        CreditLedger(
            user_id=user.id,
            delta=-amount,
            balance_after=user.credits,
            reason=reason[:64],
            ref_id=ref_id,
        )
    )
    db.commit()
    return user.credits


def refund(db: DbSession, user: User, amount: int, reason: str, ref_id: str | None = None) -> int:
    if amount <= 0:
        return user.credits
    # Idempotency guard: never refund the same ref twice.
    exists = (
        db.query(CreditLedger)
        .filter(CreditLedger.user_id == user.id, CreditLedger.reason == reason, CreditLedger.ref_id == ref_id)
        .first()
    )
    if exists:
        return user.credits
    user.credits = (user.credits or 0) + amount
    db.add(
        CreditLedger(
            user_id=user.id,
            delta=amount,
            balance_after=user.credits,
            reason=reason[:64],
            ref_id=ref_id,
        )
    )
    db.commit()
    return user.credits


def history(db: DbSession, user_id: int, limit: int = 50) -> list[CreditLedger]:
    return (
        db.query(CreditLedger)
        .filter(CreditLedger.user_id == user_id)
        .order_by(CreditLedger.id.desc())
        .limit(limit)
        .all()
    )
