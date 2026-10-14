# ZYVORA — Final Status

## Test results
| Gate | Result |
|---|---|
| Phase 0+1 auth gate (register→dashboard, 5s stay, F5 persistence, Projects/Assets/Settings nav, logout→login, guest no-401) | ✅ 4/4 tests, **3 consecutive runs passed** |
| Ownership (user B gets 403 on user A's project), non-admin 403 on `/api/admin/*`, duplicate email 409, admin real stats | ✅ in gate suite |
| Phase 2–4 flow (create project → add cube → rotate 1.57 → autosave → reload → persisted → character → send to 3D → keyframes → Play moves time → Add to scene → shot → render job **completed**) | ✅ in gate suite |
| Frontend production build (`tsc -b && vite build`) | ✅ |
| Backend import + `/health` DB check | ✅ |

Bugs found & fixed by the gate: (1) gizmo `onObjectChange` loop starved the autosave debounce; (2) stale in-flight autosave PUT could overwrite newer data (now fresh-read + serialized); (3) gizmo overwrote typed numeric transforms (now commit on mouse-up); (4) auth rate limiter tripped by repeated test runs (10→25/min, still enforced); (5) Chromium in this sandbox needs the Amazon-Linux libs bundled in `@sparticuz/chromium` (`playwright.config.mjs` extracts them automatically).

## Module status
| Module | Status |
|---|---|
| Design tokens / dark-first theme / light option / Logo component | Working (logo file interim — see README note) |
| Landing, Register, Login, Check-email, Forgot/Reset, Verify pages (UZ/EN/RU) | Working |
| Auth architecture (refresh rotation, hint flag, sessionVersion, interceptor) | Working |
| App shell, sidebar studio switching, AI dock | Working |
| Shared project store, Undo/Redo, autosave, version counter | Working |
| Projects (CRUD, duplicate, rename), Assets, Comments | Working |
| 3D Studio (primitives, gizmo, materials, hierarchy, GLB/OBJ import name, GLB/JSON export) | Working (GLB import loads name/placeholder mesh; full GLTF scene-graph import = Partially) |
| 2D Studio (brush/pencil/eraser/fill, layers, PNG in/out) | Working (single active layer canvas) |
| Character Studio (profile, views, expressions, outfits, send to 3D/Animation) | Working |
| Animation Studio (keyframes, scrub, Play/Stop, AI run proposal local) | Working (auto-rigging: Coming soon) |
| Cinema Studio (shots, outliner, sequencer, render queue) | Working (local worker = PNG-sequence manifest job; MP4 needs ffmpeg worker) |
| Render Queue (progress, polling, retry) | Working |
| ZYVORA AI Mentor/Copilot/Builder (whitelisted, backend-validated) | Working locally; external providers **Not connected** |
| AI Image & Video Lab, Audio & VFX | **Not connected** (honest badges, no fake output) |
| Story Studio | Working (logline/scenes in shared doc) |
| Admin panel (real stats, users, block, providers, audit) | Working |
| Credits ledger (welcome 100, spend/refund, monthly limit fields) | Working |
| Plans Free/Pro/Studio | Partially (plan field + limits; checkout blocked by payments) |
| Payments (Stripe adapter, webhook idempotency, signature verify util) | **Not connected** (503 until keys set) |
| Marketplace, Team invites | Coming soon (comments + roles basics Working) |
| Postgres/Redis/MinIO (docker-compose) | Partially (compose provided; local dev uses SQLite — same SQLAlchemy schema) |
| Blender integration | Coming soon |

## Prioritized roadmap
1. Swap in the official logo file; per-layer 2D canvases + selection transforms; full GLTF scene-graph import.
2. Wire OpenAI/Tripo/Meshy/Image/Video/Audio adapters (keys → live jobs with credit estimate → confirm → refund-on-failure, already modelled in the ledger).
3. Render worker service (Redis queue + ffmpeg MP4) replacing the in-process local worker.
4. Stripe checkout + webhook-driven credit grants (idempotency table exists); plans enforcement at spend time.
5. Team invites with per-project roles; marketplace on top of payments.
6. Alembic autogenerate baseline for Postgres; backups + monitoring in compose.
