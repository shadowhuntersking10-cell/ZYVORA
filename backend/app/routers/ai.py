from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.encoders import jsonable_encoder
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.ai.providers import ADAPTERS, get_adapter
from app.audit import audit
from app.credits import PLAN_MONTHLY_AI_CREDITS, adjust_balance
from app.db import get_db
from app.deps import get_current_user
from app.models import AIJob, User
from app.ratelimit import rate_limit
from app.schemas import AIEstimateIn, AIRunIn

router = APIRouter(prefix="/api/ai", tags=["ai"])


def _spent_this_month(db: Session, user: User) -> int:
    start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    total = db.scalar(select(func.coalesce(func.sum(AIJob.charged_credits), 0))
                      .where(AIJob.user_id == user.id, AIJob.created_at >= start))
    return int(total or 0)


def _estimate(provider: str, task: str, units: int) -> tuple[int, bool]:
    adapter = get_adapter(provider)
    if task not in adapter.tasks:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, f"Unsupported task '{task}' for {provider}")
    return adapter.tasks[task].unit_cost * units, adapter.is_connected()


def _job_out(job: AIJob) -> dict:
    return {
        "id": job.id,
        "provider": job.provider,
        "task": job.task,
        "status": job.status,
        "cost_credits": job.cost_credits,
        "charged_credits": job.charged_credits,
        "error": job.error,
        "result": job.result,
        "created_at": job.created_at,
    }


@router.get("/providers")
def providers(user: User = Depends(get_current_user)):
    return [a.status_info() for a in ADAPTERS.values()]


@router.post("/estimate")
def estimate(body: AIEstimateIn, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    cost, connected = _estimate(body.provider, body.task, body.units)
    limit = PLAN_MONTHLY_AI_CREDITS.get(user.plan, 0)
    spent = _spent_this_month(db, user)
    return {
        "cost_credits": cost,
        "balance": user.credit_balance,
        "monthly_limit": limit,
        "monthly_spent": spent,
        "sufficient_balance": user.credit_balance >= cost,
        "within_monthly_limit": spent + cost <= limit,
        "provider_connected": connected,
        "requires_confirmation": True,
    }


@router.post("/run", status_code=201, dependencies=[Depends(rate_limit("ai_run"))])
def run(body: AIRunIn, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    adapter = get_adapter(body.provider)
    cost, connected = _estimate(body.provider, body.task, body.units)
    if not connected:
        job = AIJob(user_id=user.id, project_id=body.project_id, provider=body.provider, task=body.task,
                    status="not_connected", cost_credits=cost, charged_credits=0,
                    error=f"{adapter.label}: provider not connected")
        db.add(job)
        db.commit()
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            {"message": "provider not connected", "job": jsonable_encoder(_job_out(job))})
    if not body.confirmed:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            {"message": "Confirmation required", "cost_credits": cost})
    limit = PLAN_MONTHLY_AI_CREDITS.get(user.plan, 0)
    if _spent_this_month(db, user) + cost > limit:
        raise HTTPException(status.HTTP_402_PAYMENT_REQUIRED, "Monthly AI limit for your plan is reached")
    # Reserve (charge) before calling the provider; refund if the provider fails.
    adjust_balance(db, user, -cost, reason=f"ai.{body.provider}.{body.task}")
    job = AIJob(user_id=user.id, project_id=body.project_id, provider=body.provider, task=body.task,
                status="running", cost_credits=cost, charged_credits=cost, result={})
    db.add(job)
    db.flush()
    result = adapter.run(body.task, body.prompt, body.units)
    _apply_result(db, user, job, result)
    audit(db, "ai.run", actor_id=user.id, target=job.id,
          detail={"provider": body.provider, "task": body.task, "status": job.status}, request=request)
    db.commit()
    return _job_out(job)


def _apply_result(db: Session, user: User, job: AIJob, result) -> None:
    if result.status == "failed":
        job.status = "failed"
        job.error = result.error
        adjust_balance(db, user, job.charged_credits, reason="ai.refund.provider_failure", reference=job.id)
        job.charged_credits = 0
    elif result.status == "not_connected":
        job.status = "not_connected"
        job.error = result.error
        adjust_balance(db, user, job.charged_credits, reason="ai.refund.not_connected", reference=job.id)
        job.charged_credits = 0
    else:
        job.status = result.status
        job.result = result.output
        job.error = result.error


@router.get("/jobs")
def list_jobs(user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    rows = db.scalars(select(AIJob).where(AIJob.user_id == user.id).order_by(AIJob.created_at.desc()).limit(100))
    return [_job_out(j) for j in rows]


@router.get("/jobs/{job_id}")
def get_job(job_id: str, request: Request, user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    job = db.get(AIJob, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Job not found")
    if job.status == "running" and job.result.get("provider_task_id"):
        adapter = get_adapter(job.provider)
        result = adapter.poll(job.result["provider_task_id"])
        if result.status in ("succeeded", "failed"):
            _apply_result(db, user, job, result)
        else:
            job.result = {**job.result, **result.output}
        db.commit()
    return _job_out(job)
