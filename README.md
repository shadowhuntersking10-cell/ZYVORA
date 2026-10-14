# ZYVORA

One web workspace for AI-assisted anime, 3D, animation and cinema creation.
One codebase, one login, one shared project document.

> **Honest status:** this is a foundation build. The unified workspace, auth, projects with autosave,
> the admin panel, the 3D Studio and the AI adapters are real. Most studios are **Coming soon** and
> are disabled on purpose. See [Status](#status) before relying on any module.

## Layout

```
ZYVORA/
├── docker-compose.yml        full stack: Postgres, Redis, MinIO, API, nginx web
├── .env.example              every environment variable, documented
├── backend/                  FastAPI + SQLAlchemy + Alembic
│   ├── app/
│   │   ├── main.py           app factory, CORS, security headers
│   │   ├── config.py         settings from environment
│   │   ├── models.py         users, sessions, tokens, projects, versions, audit, credits, AI jobs
│   │   ├── security.py       argon2 hashing, JWT access tokens, opaque refresh tokens
│   │   ├── deps.py           current user, admin guard (403 for non-admins)
│   │   ├── credits.py        the ONLY place credit balances change (writes the ledger)
│   │   ├── ratelimit.py      per-IP sliding window on sensitive routes
│   │   ├── email.py          email adapter (SMTP not connected => reports not sent)
│   │   ├── ai/providers.py   OpenAI, Meshy, Tripo, Stability adapters; video/audio slots
│   │   └── routers/          auth.py, projects.py, ai.py, admin.py
│   ├── alembic/              migrations (0001_initial_schema)
│   ├── scripts/seed_admin.py creates ONLY the first admin from environment variables
│   └── tests/                pytest suite (35 tests)
└── frontend/                 React + TypeScript (strict) + Vite + Tailwind + Zustand + react-three-fiber
    ├── src/domain/           shared project document + typed commands (pure, validated)
    ├── src/store/            project store (history, autosave), auth, preferences
    ├── src/layout/           AppShell (sidebar, top bar), Workspace (center/right/bottom regions)
    ├── src/studios/          3D Studio (real Three.js), AI Lab, Coming-soon registry
    ├── src/ai/               ZYVORA AI panel, cost-confirmed runner, Inspector rules
    ├── src/pages/            auth, dashboard, projects, settings, render queue, admin panel
    ├── src/lib/i18n.ts       Uzbek / English / Russian dictionaries
    └── e2e/                  Playwright spec (written, not executed in this sandbox)
```

## Architecture in brief

* **One project document.** `ProjectDocument` (see `frontend/src/domain/document.ts`) holds objects, and reserved
  sections for characters, animation, cameras, shots, layers, audio and story. Every studio reads it from the
  Zustand store. Nothing else mutates it.
* **Typed commands.** `applyCommand(doc, cmd)` is a pure function. It validates input (finite numbers, positive
  scale, hex colors, known ids) and returns a new document. Invalid commands are rejected without touching history.
* **Global undo/redo.** Each entry stores before/after documents and the studio that made the change. Ctrl+Z and
  Ctrl+Shift+Z work in every studio. Limit: 200 entries.
* **Autosave.** Changes are saved 1.5 s after the last edit with `base_version`. A stale version returns 409 and the
  top bar shows "Version conflict". Each save creates a version (last 50 kept). Pending edits are flushed before
  switching or closing a project.
* **Studio switching.** Sidebar links change the route inside the same shell. The project stays open. Studio modules
  are lazy-loaded. Per-studio view state (camera, draft text) is kept in the store.
* **Ownership is enforced on the backend.** Every project route filters by `owner_id`. Other users get 404.
* **Credits.** Balances change only through `adjust_balance`, which writes a ledger row. AI jobs charge before the
  call and refund on provider failure.
* **AI honesty.** A missing key returns `503 provider not connected`, charges nothing and creates a job marked
  `not_connected`. Expensive runs show an estimate and need a confirmation checkbox.

## Run it

### Docker (full stack)

```bash
cp .env.example .env          # set JWT_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD (and provider keys if you have them)
docker compose up --build
# Open http://localhost:8080
docker compose exec api python -m scripts.seed_admin   # creates the first admin from .env
```

Only `web` (port 8080) is published. The API is reachable only through nginx at `/api`.

### Local development

Backend (SQLite for quick dev, or set `DATABASE_URL` to PostgreSQL):

```bash
cd backend
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
export ADMIN_EMAIL=admin@example.com ADMIN_PASSWORD='change-me-admin-1'
alembic upgrade head              # or rely on dev auto-create on sqlite
python -m scripts.seed_admin
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Frontend:

```bash
cd frontend
npm ci
npm run dev        # http://localhost:5173 ; /api is proxied to ZYVORA_API_URL (default http://localhost:8000)
```

### Tests

```bash
cd backend && python -m pytest          # 35 tests
cd frontend && npm test                 # 22 Vitest tests
cd frontend && npm run typecheck        # strict TypeScript
cd frontend && npm run build
cd frontend && E2E_BASE_URL=http://localhost:8080 npm run test:e2e   # needs a running stack and Playwright browsers
```

## API routes

| Method | Path | Notes |
|---|---|---|
| GET | /api/health | liveness |
| POST | /api/auth/register | rate-limited; verification email only when enabled |
| POST | /api/auth/login | returns access token; refresh token is an httpOnly cookie |
| POST | /api/auth/refresh | rotates refresh token |
| POST | /api/auth/logout | revokes current session |
| GET / PATCH | /api/auth/me | profile (name, avatar URL) |
| POST | /api/auth/me/password | revokes all other sessions |
| GET | /api/auth/me/sessions | active sessions |
| DELETE | /api/auth/me/sessions/{id} | revoke one session |
| POST | /api/auth/me/delete | delete account (password required; last admin protected) |
| POST | /api/auth/forgot | always 202; reports whether email was sent |
| POST | /api/auth/reset-password | one-time token |
| POST | /api/auth/verify-email | one-time token |
| GET / POST | /api/projects | list (search `q`, `folder`) / create |
| GET / PATCH / DELETE | /api/projects/{id} | own projects only; delete is soft |
| POST | /api/projects/{id}/duplicate | copy |
| GET | /api/projects/folders | folder names |
| PUT | /api/projects/{id}/document | autosave; `base_version` checked (409 on conflict) |
| GET | /api/projects/{id}/versions | version history |
| POST | /api/projects/{id}/versions/{v}/restore | restore as a new version |
| GET | /api/ai/providers | connection status per provider (no keys) |
| POST | /api/ai/estimate | cost before generation |
| POST | /api/ai/run | run a task; 503 when provider not connected; 402 when credits or monthly limit reached |
| GET | /api/ai/jobs | own jobs |
| GET | /api/ai/jobs/{id} | own job; polls async providers (Meshy/Tripo) |
| GET | /api/admin/stats | real database counts |
| GET | /api/admin/users | search, paginate |
| GET / PATCH | /api/admin/users/{id} | detail with ledger; role and plan changes |
| POST | /api/admin/users/{id}/block | block (revokes sessions) or restore |
| POST | /api/admin/users/{id}/credits | adjust balance (ledger + audit) |
| GET | /api/admin/providers | provider status and usage |
| GET | /api/admin/jobs | AI jobs, filter by status |
| GET | /api/admin/system | service connection status |
| GET | /api/admin/payments | gateway status and (empty) orders |
| GET | /api/admin/audit | audit log, filter by action prefix |

All `/api/admin/*` routes return 401 without a token and 403 for normal users.

## Test checklist

| Area | Automated | Result here |
|---|---|---|
| Registration, duplicate email, weak password | pytest `test_auth.py` | pass |
| Login, refresh rotation, logout, change password revokes sessions | pytest | pass |
| Forgot password does not reveal account existence | pytest | pass |
| Delete account requires password | pytest | pass |
| Project save persists document; version history | pytest `test_projects.py` | pass |
| Stale save returns 409 | pytest | pass |
| Users cannot read or write other users' projects | pytest | pass |
| Admin routes: 401 anonymous, 403 user, 200 admin | pytest `test_admin.py` | pass |
| Last admin cannot be removed or blocked; cannot block self | pytest | pass |
| Credit adjustments write ledger and audit | pytest | pass |
| Provider missing key: "provider not connected", no charge | pytest `test_ai.py` | pass |
| Confirmation required; insufficient credits 402 | pytest | pass |
| Provider failure refunds credits; async jobs refunded on failure | pytest | pass |
| Seed creates only the first admin, idempotent | pytest `test_health.py` | pass |
| Migration applies and reverts (SQLite) | manual `alembic upgrade/downgrade` | pass |
| Live API flows through the Vite proxy (register, save, 409, 403, 503, block) | manual curl | pass |
| Command engine: pure, validated, no mutation | Vitest | pass |
| Undo/redo across studios; autosave payload and conflict status | Vitest | pass |
| AI Inspector rules | Vitest | pass |
| Translation coverage for shared keys (uz, ru) | Vitest | pass |
| App routing: anonymous user redirected to login | Vitest | pass |
| 3D Studio: add, select, move/rotate/scale gizmo, undo, export | **manual in a browser** | **not run here** (no browser in sandbox) |
| Critical E2E flow (register → project → add cube → undo) | Playwright `e2e/critical.spec.ts` | **written, not executed** |
| Docker compose stack builds and starts | manual | **not run here** (no Docker in sandbox) |
| PostgreSQL migration | manual | **not run here** (validated on SQLite only) |
| Payment webhook idempotency | — | **not built** (no payment code yet) |

## Status

Legend: **Working** = built and verified by tests or live calls here · **Partially working** = real, with gaps ·
**Not connected** = built slot, no provider/service configured · **Coming soon** = not built, disabled in UI.

| Module | Status | Notes |
|---|---|---|
| Unified workspace shell (sidebar, top bar, studio switching without reload) | Working | Built; UI not visually verified in a browser here |
| Shared project store, typed commands, global undo/redo | Working | Unit tested |
| Autosave with version history and conflict detection | Working | Live-tested through the proxy |
| Auth: register, login, logout, refresh rotation, /me, profile, remember-me | Working | Password: 8+ characters, upper and lower case, a digit |
| Auth: change password, sessions, delete account | Working | |
| Auth: email verification (+ resend), forgot/reset password | Partially working | Tokens work; email delivery **Not connected** (no SMTP), so the pages say so honestly |
| Profile photo upload | Partially working | Avatar is a URL field only; no file upload (no storage) |
| Notifications and privacy settings | Coming soon | |
| My Projects: search, folders, rename, duplicate, delete | Working | |
| Dashboard: recent projects, jobs, credits, spend this month | Working | Real data only |
| Render Queue | Partially working | Lists AI jobs. Progress/ETA, retry **Coming soon**; no video/Blender render |
| 3D Studio: primitives, select, gizmo, hierarchy, materials, undo | Working | Scene lights are fixed defaults; no light editing yet |
| 3D Studio: cameras, GLB/glTF/OBJ import/export | Coming soon | JSON export works |
| 3D Studio: scene JSON saved to the database | Working | Through autosave |
| 3D Studio: AI text → 3D (Meshy, Tripo) | Partially working | Real adapter calls; untested against live APIs (no keys). Result is a remote URL; import into scene not built |
| Send to: Animate, Put in scene, character sheet, asset library | Coming soon | Shown disabled |
| ZYVORA AI: Mentor | Working when OpenAI key set | Not connected without `OPENAI_API_KEY` |
| ZYVORA AI: Inspector | Working | Deterministic rules, no AI cost |
| ZYVORA AI: Director | Partially working | Plans with OpenAI; plan execution not built |
| ZYVORA AI: Builder, Copilot, Agent | Coming soon | |
| AI Image (Stability text → image) | Partially working | Real adapter; untested against live API |
| AI Video | Not connected | Slot only; no endpoint implemented; fails honestly with a key |
| Audio / voice | Not connected | Slot only |
| 2D Studio, Character Studio, Animation Studio, Cinema Studio | Coming soon | |
| Audio & VFX, Story & Storyboard | Coming soon | |
| Asset Library, Team & Collaboration, Marketplace | Coming soon | |
| Create with AI (multi-studio AI Director run) | Coming soon | |
| Share button | Coming soon | Disabled |
| Blender / ffmpeg render worker | Coming soon | Admin shows "not built" |
| Credits: ledger, admin adjustments, monthly limits per plan | Working | |
| Credit packages and purchases | Not connected | No payment gateway |
| Payments, orders, subscriptions, refunds (Stripe) | Not connected | Admin page shows real (empty) state. No webhook handler, so no idempotency to test yet |
| Plans and subscription management | Partially working | Admin can set plan labels; no billing |
| Profit / cost report | Coming soon | |
| Admin: Dashboard (real counts) | Working | |
| Admin: Users (search, detail, block/restore, role, plan, credits) | Working | |
| Admin: AI & API status and usage | Working | Keys never shown |
| Admin: Jobs & System monitoring | Working | Safe retry Coming soon |
| Admin: Security & audit log | Working | |
| Admin: Platform settings | Coming soon | Read-only notes only |
| i18n: Uzbek, English, Russian (shell, auth, workspace, settings) | Working | Admin panel is English-only → Partially working |
| Light and dark theme | Working | |
| Rate limiting | Partially working | In-memory per process; not shared across API replicas |
| Security headers, CORS, same-site refresh cookie | Working | CSP is set by nginx |
| Team, comments, versions UI | Coming soon | Project versions exist in the API |
| Object storage (MinIO / S3) | Not connected | Provisioned in compose; API does not upload yet |
| Redis background worker | Not connected | Provisioned in compose; no worker code |
| Seed: first admin only | Working | Rejects addresses the login validator refuses |

## Known limitations

* Registration reveals whether an email is taken (409). This is a deliberate UX trade-off; with email delivery
  connected, switch to a generic response.
* Refresh-token and rate-limit state is per process. Move to Redis before running several API replicas.
* The 3D Studio was built and type-checked but not visually exercised in a browser in this environment.
* Admin panel strings are English-only.
* Migrations were validated on SQLite. Run them against PostgreSQL before production.

## Roadmap (priority order)

1. **Verify the UI in a real browser:** run the Playwright suite against docker compose; fix layout issues in the 3D Studio.
2. **Connect the platform services:** SMTP (verification and reset), MinIO uploads (assets, GLB files), Redis + worker for async jobs with retries.
3. **Payments:** Stripe checkout, signed webhook handler, `payment_events` table with unique event ids (idempotency), credit grants in one transaction, refunds that reverse credits.
4. **Animation Studio:** keyframe tracks on the shared document, Animate handoff from 3D Studio.
5. **Character Studio** and **2D Studio** (canvas tools), then **Cinema Studio** with a shot list and render worker (ffmpeg).
6. **AI Builder and Copilot:** whitelisted editor tools, every call validated and applied through the command system.
7. **Asset Library, Marketplace, Teams**, then the story/storyboard studio and PDF export.
8. **Production hardening:** shared rate limiting, Postgres migration tests, Dependabot, backups, load testing.
