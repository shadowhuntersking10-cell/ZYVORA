import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request, status

from app.config import get_settings

_lock = threading.Lock()
_hits: dict[str, deque[float]] = defaultdict(deque)


def reset_rate_limits() -> None:
    with _lock:
        _hits.clear()


def rate_limit(bucket: str):
    """FastAPI dependency: sliding-window limiter per client IP and bucket."""

    def dependency(request: Request) -> None:
        limit = get_settings().rate_limit_per_minute
        ip = request.client.host if request.client else "unknown"
        key = f"{bucket}:{ip}"
        now = time.monotonic()
        with _lock:
            q = _hits[key]
            while q and now - q[0] > 60:
                q.popleft()
            if len(q) >= limit:
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail="Too many requests. Please wait a minute.",
                )
            q.append(now)

    return dependency
