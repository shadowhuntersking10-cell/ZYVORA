"""Generation job service + in-process worker.

Single-process deployment uses this asyncio worker (no external broker needed).
For horizontal scaling the same table can be consumed by separate workers
(see README "Scaling" section).
"""
from __future__ import annotations

import asyncio
import base64
import logging
import time
from datetime import timedelta

from sqlalchemy.orm import Session as DbSession

from ..config import DATA_DIR, get_settings
from ..models import AppSetting, Asset, GenJob, ProviderSetting, UsageRecord, User, utcnow
from . import audit as audit_svc
from . import credits
from .providers import ProviderError, ProviderNotConfigured, adapters_for_kind, get_adapter

log = logging.getLogger("zyvora.gen")

DEFAULT_PRICING = {"image": 5, "video": 40, "3d": 25, "text": 1}
GEN_DIR = DATA_DIR / "gen"


def get_pricing(db: DbSession) -> dict:
    row = db.get(AppSetting, "pricing")
    if row and isinstance(row.value, dict):
        merged = dict(DEFAULT_PRICING)
        merged.update({k: int(v) for k, v in row.value.items() if k in DEFAULT_PRICING and int(v) >= 0})
        return merged
    return dict(DEFAULT_PRICING)


def set_pricing(db: DbSession, pricing: dict) -> None:
    merged = dict(DEFAULT_PRICING)
    merged.update({k: max(0, int(v)) for k, v in pricing.items() if k in DEFAULT_PRICING})
    row = db.get(AppSetting, "pricing")
    if row is None:
        row = AppSetting(key="pricing", value=merged)
        db.add(row)
    else:
        row.value = merged
    db.commit()


def provider_enabled(db: DbSession, name: str) -> bool:
    row = db.get(ProviderSetting, name)
    return True if row is None else bool(row.enabled)


def pick_provider(db: DbSession, kind: str) -> tuple[object | None, str | None]:
    """First configured+enabled adapter for the kind, else (None, honest reason)."""
    for adapter in adapters_for_kind(kind):
        if not adapter.configured:
            continue
        if provider_enabled(db, adapter.name):
            return adapter, None
        continue  # disabled -> try next adapter
    missing = ", ".join(
        f"{a.name} ({', '.join(a.info.env_keys)})" for a in adapters_for_kind(kind)
    )
    return None, f"no provider configured for '{kind}'. Required env keys: {missing}"


def estimate_cost(db: DbSession, kind: str) -> int:
    return get_pricing(db).get(kind, 0)


class GenError(Exception):
    pass


def create_job(
    db: DbSession,
    user: User,
    kind: str,
    prompt: str,
    params: dict | None = None,
    idempotency_key: str | None = None,
) -> tuple[GenJob | None, str | None, int]:
    """Validate + reserve credits + enqueue. Returns (job, error, cost)."""
    settings = get_settings()
    prompt = (prompt or "").strip()
    if kind not in ("image", "video", "3d", "text"):
        return None, "invalid kind", 0
    if not (3 <= len(prompt) <= 4000) and kind != "3d":
        return None, "prompt must be 3..4000 characters", 0
    if idempotency_key:
        existing = (
            db.query(GenJob)
            .filter(
                GenJob.user_id == user.id,
                GenJob.idempotency_key == idempotency_key,
                GenJob.created_at > utcnow() - timedelta(hours=24),
            )
            .first()
        )
        if existing:
            return existing, None, existing.cost_credits

    day_start = utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = (
        db.query(GenJob).filter(GenJob.user_id == user.id, GenJob.created_at >= day_start).count()
    )
    if today_count >= settings.gen_daily_limit:
        return None, f"daily limit reached ({settings.gen_daily_limit})", 0

    active = (
        db.query(GenJob)
        .filter(GenJob.user_id == user.id, GenJob.status.in_(("queued", "running")))
        .count()
    )
    if active >= settings.gen_max_concurrent:
        return None, "too many active jobs, wait for them to finish", 0

    cost = estimate_cost(db, kind)
    job = GenJob(
        user_id=user.id,
        kind=kind,
        provider="",
        prompt=prompt,
        params=params or {},
        status="queued",
        cost_credits=cost,
        idempotency_key=idempotency_key,
    )
    try:
        credits.reserve(db, user, cost, "gen_reserve", ref_id=f"job:{job.id if job.id else 'new'}")
    except credits.CreditError:
        return None, "insufficient credits", cost
    db.add(job)
    db.commit()
    db.refresh(job)
    # ledger ref needs the real id
    ledger = (
        db.query(type(job))
        .filter(type(job).id == job.id)
        .first()
    )
    if ledger is not None:
        db.add(UsageRecord(user_id=user.id, job_id=job.id, provider="", kind=kind, credits_reserved=cost))
        db.commit()
    audit_svc.audit_log(
        db,
        "gen.submit",
        actor_id=user.id,
        actor_label=user.email or f"tg:{user.telegram_id}",
        target=f"job:{job.id}",
        detail={"kind": kind, "cost": cost},
        commit=False,
    )
    db.commit()
    return job, None, cost


def refund_job(db: DbSession, job: GenJob, reason: str) -> None:
    user = db.get(User, job.user_id)
    if user is None or job.cost_credits <= 0:
        return
    credits.refund(db, user, job.cost_credits, reason, ref_id=f"job:{job.id}")


def _save_result_asset(db: DbSession, job: GenJob, image_bytes: bytes, ext: str) -> str:
    GEN_DIR.mkdir(parents=True, exist_ok=True)
    user_dir = GEN_DIR / str(job.user_id)
    user_dir.mkdir(parents=True, exist_ok=True)
    path = user_dir / f"job_{job.id}.{ext}"
    path.write_bytes(image_bytes)
    rel = str(path.relative_to(DATA_DIR))
    db.add(
        Asset(
            owner_id=job.user_id,
            name=f"{job.kind}_{job.id}.{ext}",
            kind="image" if ext in ("png", "jpg", "webp") else "file",
            mime={"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}.get(ext, "application/octet-stream"),
            size=len(image_bytes),
            path=rel,
            meta={"source": "ai", "job_id": job.id, "provider": job.provider},
        )
    )
    return rel


def run_job_sync(db_factory, job_id: int) -> None:
    """Executed in a worker thread with its own DB session."""
    db = open_session(db_factory)
    try:
        job = db.get(GenJob, job_id)
        if job is None or job.status != "queued":
            return
        user = db.get(User, job.user_id)
        adapter, err = pick_provider(db, job.kind)
        if adapter is None:
            _fail(db, job, err or "no provider", refund=True)
            return
        job.provider = adapter.name
        job.status = "running"
        job.started_at = utcnow()
        job.error = None
        db.commit()

        try:
            outcome = adapter.submit(job.kind, job.prompt, job.params or {})
        except ProviderNotConfigured as exc:
            _fail(db, job, str(exc), refund=True)
            return
        except ProviderError as exc:
            _fail(db, job, f"provider error: {exc}", refund=True)
            return
        except Exception as exc:  # noqa: BLE001
            _fail(db, job, f"unexpected error: {exc}", refund=True)
            return

        if outcome.get("provider_job_id"):
            job.provider_job_id = str(outcome["provider_job_id"])
            db.commit()
            # async provider: poll within the thread (bounded)
            deadline = utcnow() + timedelta(minutes=20)
            while utcnow() < deadline:
                db.expire_all()
                job = db.get(GenJob, job_id)
                if job is None or job.status != "running":
                    return
                try:
                    poll = adapter.poll(job.provider_job_id, job.params or {})
                except ProviderError as exc:
                    _fail(db, job, f"provider error: {exc}", refund=True)
                    return
                job.progress = int(poll.get("progress", 0))
                db.commit()
                if poll.get("status") == "completed":
                    result = poll.get("result") or {}
                    _complete_from_url(db, job, result)
                    return
                if poll.get("status") == "failed":
                    _fail(db, job, poll.get("error") or "provider failed", refund=True)
                    return
                time.sleep(6)
            _fail(db, job, "provider timeout", refund=True)
            return

        # synchronous result
        result = outcome.get("result") or {}
        if "image_bytes" in result:
            rel = _save_result_asset(db, job, result["image_bytes"], "png")
            _complete(db, job, {"file": rel})
        elif "image_b64" in result:
            rel = _save_result_asset(db, job, base64.b64decode(result["image_b64"]), "png")
            _complete(db, job, {"file": rel})
        elif "text" in result:
            _complete(db, job, {"text": result["text"]})
        else:
            _complete(db, job, result)
    finally:
        db.close()


def _complete(db: DbSession, job: GenJob, result_meta: dict) -> None:
    job.status = "completed"
    job.progress = 100
    job.result_meta = result_meta
    job.finished_at = utcnow()
    usage = db.query(UsageRecord).filter(UsageRecord.job_id == job.id).first()
    if usage:
        usage.credits_used = job.cost_credits
        usage.provider = job.provider
    user = db.get(User, job.user_id)
    if user:
        audit_svc.notify(db, user.id, "job", f"✅ {job.kind} #{job.id} — completed", commit=False)
    db.commit()
    log.info("job %s completed via %s", job.id, job.provider)


def _complete_from_url(db: DbSession, job: GenJob, result: dict) -> None:
    url = result.get("glb_url") or result.get("video_url") or result.get("obj_url")
    _complete(db, job, {"url": url, **{k: v for k, v in result.items() if k not in ("glb_url", "obj_url", "video_url")}})


def _fail(db: DbSession, job: GenJob, error: str, *, refund: bool) -> None:
    job.status = "failed"
    job.error = (error or "unknown error")[:1000]
    job.finished_at = utcnow()
    if refund:
        refund_job(db, job, "gen_refund")
    usage = db.query(UsageRecord).filter(UsageRecord.job_id == job.id).first()
    if usage:
        usage.credits_refunded = job.cost_credits if refund else 0
        usage.provider = job.provider
    user = db.get(User, job.user_id)
    if user:
        audit_svc.notify(db, user.id, "job", f"❌ {job.kind} #{job.id} — failed", commit=False)
    db.commit()
    log.warning("job %s failed: %s", job.id, error)


def retry_job(db: DbSession, job: GenJob) -> tuple[bool, str | None]:
    if job.status not in ("failed", "canceled"):
        return False, "only failed jobs can be retried"
    user = db.get(User, job.user_id)
    if user is None:
        return False, "user missing"
    try:
        credits.reserve(db, user, job.cost_credits, "gen_reserve", ref_id=f"job:{job.id}:r{job.version if hasattr(job, 'version') else job.id}")
    except credits.CreditError:
        return False, "insufficient credits for retry"
    job.status = "queued"
    job.error = None
    job.progress = 0
    job.started_at = None
    job.finished_at = None
    db.commit()
    return True, None


def open_session(db_factory):
    """Accepts either a Session factory or a sessionmaker; always returns a Session."""
    s = db_factory()
    if not isinstance(s, DbSession):
        s = s()
    return s


class GenerationWorker:
    """Asyncio background worker; safe for a single web process."""

    def __init__(self, db_factory, poll_interval: float = 2.0):
        self.db_factory = db_factory
        self.poll_interval = poll_interval
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self.last_error: str | None = None

    def start(self) -> None:
        self._task = asyncio.get_running_loop().create_task(self._loop(), name="gen-worker")

    async def stop(self) -> None:
        self._stop.set()
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    async def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                await self._tick()
            except asyncio.CancelledError:
                return
            except Exception as exc:  # noqa: BLE001
                self.last_error = str(exc)
                log.exception("worker tick failed: %s", exc)
            try:
                await asyncio.wait_for(self._stop.wait(), timeout=self.poll_interval)
            except TimeoutError:
                pass

    async def _tick(self) -> None:
        db = open_session(self.db_factory)
        try:
            queued = db.query(GenJob).filter(GenJob.status == "queued").order_by(GenJob.id).all()
            ids = [j.id for j in queued]
        finally:
            db.close()
        for job_id in ids:
            await asyncio.to_thread(run_job_sync, self.db_factory, job_id)
