# ZYVORA — AI Creative Studio

Professional AI creative platform: **website + Telegram bot + Telegram WebApp + admin panel**,
all started with a single command:

```bash
python main.py
```

- 🎨 **2D Studio** — canvas editor: layers, brush/eraser, undo/redo, import, PNG export
- 🧊 **3D Studio** — interactive Three.js scene: primitives, transforms, materials, GLTF/OBJ export
- 🎞 **Animation Studio** — frame-by-frame timeline, playback, onion skin, FPS, PNG export
- 🧑‍🎨 **Character Studio** — character sheets with reference images and palettes
- 🪄 **AI Generator** — real provider adapters (OpenAI, Stability, Meshy, Runway) with an
  honest credit system — missing credentials are clearly reported, never faked
- 🤖 **AI Assistant** — inspects your *real* project via a strict tool registry
  (mentor / copilot / agent modes), works locally without any API key
- 🛡 **Admin Panel** — real database metrics, user management, provider health, broadcast,
  audit log (visible in the WebApp for admin Telegram IDs, on the website for admin roles)
- ✈️ **Telegram bot** — `/start` shows the WebApp button; admins get extra commands
- 🌐 Website (landing, register/login, dashboard), 3 languages (**O'zbek / English / Русский**),
  **day/night** Soft-UI theme (dark navy & light blue)
- 🗄 **MySQL** (primary) with automatic schema migrations (Alembic) and an explicit SQLite dev fallback

---

## 1. Quick start (development)

Requirements: **Python 3.11+** (MySQL optional in dev).

```bash
python -m venv .venv && source .venv/bin/activate   # optional
pip install -r requirements.txt
cp .env.example .env                                 # edit values
python main.py
```

Open:

| URL | What |
|---|---|
| `http://localhost:8000/` | Website (landing) |
| `http://localhost:8000/login` · `/register` | Auth |
| `http://localhost:8000/dashboard` | User workspace (full studio) |
| `http://localhost:8000/app` | Telegram WebApp entry |
| `http://localhost:8000/health` | Health check |
| `http://localhost:8000/api/docs` | OpenAPI docs |

Without MySQL running, ZYVORA falls back to `data/zyvora.db` (SQLite) **with a loud console
warning**. This is a development convenience — see "Production" below.

### Dev WebApp preview without Telegram

Set in `.env` (dev only!):

```
ZYVORA_DEV_WEBAPP_BYPASS=1
```

Then `http://localhost:8000/app` opens the full WebApp in a plain browser as a dev admin.
**Never enable this in production.**

## 2. MySQL setup (production database)

```sql
CREATE USER 'zyvora'@'%' IDENTIFIED BY 'strong-password';
CREATE DATABASE zyvora CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
GRANT ALL PRIVILEGES ON zyvora.* TO 'zyvora'@'%';
```

`.env`:

```
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=zyvora
MYSQL_PASSWORD=strong-password
MYSQL_DATABASE=zyvora
ZYVORA_REQUIRE_MYSQL=1          # refuse to boot without MySQL
ZYVORA_ALLOW_SQLITE_FALLBACK=0
```

`python main.py` automatically runs **Alembic migrations** (`migrations/`) and creates the
database if it does not exist. Manual migration commands:

```bash
alembic upgrade head        # apply migrations
alembic downgrade -1        # rollback one step
alembic revision --autogenerate -m "change"   # create a new migration
```

## 3. Telegram bot setup

1. Create a bot with **@BotFather** → get `BOT_TOKEN`.
2. Deploy the app behind **HTTPS** (required by Telegram WebApp).
3. `.env`:

```
BOT_TOKEN=123456:AA...
BOT_USERNAME=my_zyvora_bot
ZYVORA_PUBLIC_URL=https://your-domain.example.com
ZYVORA_ADMIN_IDS=123456789        # comma-separated Telegram IDs of admins
```

4. Run `python main.py` — the bot starts polling in the same process.
   `/start` sends a welcome message with the **WebApp button**; users with an ID in
   `ZYVORA_ADMIN_IDS` are promoted to admin and see the **admin panel** inside the WebApp.

Bot commands: `/start`, `/app`, `/lang`, `/id`, `/help`; admin-only: `/stats`, `/broadcast`, `/cancel`.

## 4. Initial administrator (website)

```
ZYVORA_ADMIN_EMAIL=admin@example.com
ZYVORA_ADMIN_PASSWORD=change-me-now        # or leave empty: a random password is printed once
```

## 5. AI providers

All providers are optional. The app starts fine without them and every related feature
shows an honest "not configured" message instead of faking results.

| Feature | Provider | Env var |
|---|---|---|
| Image / text / assistant | OpenAI | `OPENAI_API_KEY` |
| Image | Stability AI | `STABILITY_API_KEY` |
| Text→3D | Meshy | `MESHY_API_KEY` |
| Video | Runway | `RUNWAY_API_KEY` |

Keys live **only** in environment variables on the server — they are never sent to the
browser and never displayed after being set. The admin panel shows connection status,
docs links and performs safe connection tests.

### Credits & pricing

Every user has a credit balance with a full ledger (reserve → use/refund). Prices per
generation kind are configurable in the admin panel and stored in the database.
Payment integration is **not connected yet** — credits are granted by admins; the pricing
page labels paid plans honestly as "coming soon".

## 6. Email (verification & password reset)

Configure SMTP to send real emails:

```
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
SMTP_FROM=no-reply@example.com
```

Without SMTP the app **does not pretend** emails were sent: in DEBUG mode the link is
returned to the developer and logged; in production the UI clearly reports that email
delivery is not configured.

## 7. Docker Compose (production)

```bash
cp .env.example .env      # fill in real values
docker compose up -d --build
docker compose logs -f app
```

`docker-compose.yml` starts MySQL 8 + the app. Point a reverse proxy (nginx/Caddy) with
HTTPS at the app's port 8000 and set `ZYVORA_PUBLIC_URL` accordingly.

### Production checklist

- `ZYVORA_DEBUG=0`
- Random 48+ char `ZYVORA_SECRET_KEY`
- `ZYVORA_REQUIRE_MYSQL=1`
- `ZYVORA_DEV_WEBAPP_BYPASS=0`
- HTTPS + HSTS (enabled automatically when `ZYVORA_DEBUG=0`)
- Regular backups: `mysqldump zyvora > backup.sql` (restore: `mysql zyvora < backup.sql`)
  plus the `data/` uploads directory

## 8. Architecture

```
main.py                  # single entrypoint: config → DB → migrations → seed → web+bot+worker
app/
  config.py              # all settings via env/.env
  db.py                  # engine, MySQL bootstrap+fallback, sessions
  models.py              # SQLAlchemy models (users, sessions, projects, jobs, ledger, audit…)
  i18n.py                # uz/en/ru single source of truth (test-verified)
  security.py            # Argon2id, server-side sessions, CSRF, Telegram initData HMAC
  ratelimit.py           # in-process sliding window limiter
  services/              # credits, projects, generation worker, providers, assistant, email
  web/                   # routes (site/api/admin), templates, deps
  bot/                   # aiogram v3 handlers + polling runner with reconnect
static/                  # Soft UI css, SPA js modules, vendored three.js
migrations/              # Alembic
tests/                   # 70+ pytest tests (auth, RBAC, credits, jobs, assistant, i18n, migrations…)
```

**Auth model**: website uses server-side sessions (HttpOnly cookie + CSRF token);
the Telegram WebApp authenticates every request with the signed `initData` header
(HMAC-verified server-side, replay-protected by `auth_date`). Roles (`user`, `moderator`,
`admin`) are enforced server-side on every endpoint; admin Telegram IDs are protected
against demotion.

**Generation worker**: in-process asyncio worker consumes the `gen_jobs` table
(queued → running → completed/failed with credit reconciliation). For multi-instance
scaling, run additional workers against the same MySQL table (see `GenerationWorker`).

## 9. Tests

```bash
python -m pytest tests/ -q
```

70 tests cover registration/login/logout, duplicate emails, password reset, CSRF,
RBAC (user/moderator/admin), Telegram initData validation, project CRUD + versions,
ownership isolation, upload validation, the credit ledger, job lifecycle with a fake
provider, honest no-provider failures, assistant tools, migrations and i18n coverage.

## 10. Known limitations (honest list)

- Cinema Studio (scene/shot manager) is **planned** — not implemented yet.
- 2D editor stores raster layers (PNG); vector editing and pressure sensitivity are planned.
- 3D export uses Three.js GLTF/OBJ; advanced Blender integration is planned.
- Payments are not integrated: plans are displayed but cannot be purchased; revenue
  metrics report "unavailable" honestly.
- Broadcast and the WebApp button require the bot to be online and a https `ZYVORA_PUBLIC_URL`.
- The rate limiter is in-process; front it with nginx `limit_req` for multi-instance setups.
- Provider video/3D adapters (Runway/Meshy) are implemented per public API docs but were
  only verifiable with real credentials; without keys they clearly report "not configured".
