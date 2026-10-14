from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models import CreditLedger, User

PLAN_MONTHLY_AI_CREDITS = {"free": 500, "pro": 5000, "studio": 50000}


def adjust_balance(db: Session, user: User, delta: int, reason: str,
                   reference: str | None = None, actor_id: str | None = None) -> int:
    """The only place credit balances change. Every change is written to the ledger."""
    new_balance = user.credit_balance + delta
    if new_balance < 0:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Not enough credits")
    user.credit_balance = new_balance
    db.add(CreditLedger(user_id=user.id, delta=delta, balance_after=new_balance,
                        reason=reason, reference=reference, actor_id=actor_id))
    return new_balance
