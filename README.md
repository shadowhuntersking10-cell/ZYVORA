# ZYVORA

**Create anime, 3D and cinema in one place.** One integrated web platform — one login, one shared project format — for AI-assisted anime, 3D, animation and cinema creation.

> ⚠️ Logo note: the attached ZYVORA logo file was not present in this repository/workspace, so `frontend/public/brand/zyvora-logo.svg` is an interim vector mark with the same blue→violet "Z + orbit" concept. Drop the official file at that path (and `zyvora-icon.svg`) and every surface updates via the single `<Logo variant="full|icon" size/>` component. No component hardcodes a logo path elsewhere.

## Run locally

```bash
# Backend (terminal 1)
python3 -m venv .venv && .venv/bin/pip install -r backend/requirements.txt
cp .env.example .env   # set SECRET_KEY (stable!), ADMIN_* for the seeded admin
cd backend && DEV_AUTO_VERIFY=true ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD=AdminPass123 ../.venv/bin/uvicorn app.main:app --port 8000

# Frontend (terminal 2) — dev server proxies /api -> http://localhost:8000 (same origin)
cd frontend && npm install && npm run dev        # http://localhost:5173
# …or the production preview used by the e2e gate:
npm run build && npm run preview
```

Seeded admin (only when `ADMIN_EMAIL`/`ADMIN_PASSWORD` env are set): `admin@example.com / AdminPass123`.
New users get 100 welcome credits (ledger-recorded). `DEV_AUTO_VERIFY=true` auto-verifies email in dev/tests; verification/reset links are logged to the API console.

Docker: `cp .env.example .env && docker compose up --build` (Postgres, Redis, MinIO, API, web).

## Tests (mandatory quality gates)

```bash
npm install                 # Playwright + Chromium (via @sparticuz/chromium — see playwright.config.mjs)
npx playwright test         # real Chromium, no mocks; prints every /api/auth request
```

**Gate result: 4/4 tests passed, 3 consecutive runs** (register→dashboard persistence, guest-no-401, ownership 403 + admin 403 + duplicate-email 409, full 3D→animate→cinema→render flow with rotation persisted after reload).

## API routes

Auth: `POST /api/auth/register|login|refresh|logout|forgot-password|reset-password|verify-email|resend-verification|change-password`, `GET /api/auth/me|sessions`, `DELETE /api/auth/sessions/{id}`, `DELETE /api/auth/account`
Projects/Assets: `GET|POST /api/projects`, `GET|PUT|PATCH|DELETE /api/projects/{id}`, `POST /api/projects/{id}/duplicate`, `GET|POST /api/projects/{id}/comments`, `GET|POST|DELETE /api/assets`
Credits/AI/Jobs: `GET /api/credits`, `POST /api/credits/spend|refund`, `GET /api/ai/providers`, `POST /api/ai/build` (whitelisted tools only), `GET /api/jobs`, `POST /api/jobs/render`, `POST /api/jobs/{id}/retry`
Admin (403 for non-admins): `GET /api/admin/stats|users|audit|jobs`, `PATCH /api/admin/users/{id}`
Payments: `POST /api/payments/webhook/stripe` (503 until a gateway is connected; event-id idempotency)
System: `GET /` → `{"name":"ZYVORA API","status":"ok","docs":"/docs"}`, `GET /health`

## Architecture notes

- **Auth (section 5 design):** access JWT in memory (Zustand), rotating httpOnly refresh cookie (`Path=/api/auth`, SameSite=Lax), `zyvora_session_hint` localStorage flag gates bootstrap refresh (guests never get a stray 401), `sessionVersion` + shared in-flight refresh in the axios interceptor (401 only, retried once), route guard never redirects while `initializing`.
- **Unified workspace:** one Zustand project document shared by all studios via typed `apply()` commands, global Undo/Redo, autosave that reads the freshest state at fire time and serializes saves (a stale in-flight PUT can never overwrite newer data), gizmo transforms commit on mouse-up.
- **Honesty:** no provider keys ⇒ "Provider not connected" everywhere; no gateway ⇒ "Payments not connected"; admin stats are real DB counts (empty states are real).

See [docs/STATUS.md](docs/STATUS.md) for the final module status table and roadmap.
