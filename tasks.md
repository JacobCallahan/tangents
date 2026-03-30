# Tangents — Implementation Tasks

Tracks progress against the 6-phase roadmap in `tangents_spec.md`.

---

## Phase 1: Project Scaffolding & Foundation
- [x] Initialize git repository (`master` branch)
- [x] Create `tasks.md`
- [x] Initialize backend Python project with `uv`
- [x] Set up backend module structure (`app/`, `app/routers/`, `app/services/`, `tests/`)
- [x] Implement SQLAlchemy ORM models (all tables)
- [x] Implement Pydantic DTOs / schemas
- [x] Implement `AUTH_MODE` FastAPI dependency (basic + JWT)
- [x] Configure Alembic and generate initial migration
- [x] Initialize frontend with Vite + React + TypeScript
- [x] Install frontend dependencies (React Flow, dagre, Tailwind, Vitest)
- [x] Create root `.gitignore` and `README.md`
- [x] Verify backend server starts (`uvicorn`) — `/health` endpoint confirmed
- [x] Verify frontend compiles cleanly (`tsc -b && vite build` exits 0)

---

## Phase 2: AI & LLM Connectivity
- [x] Implement Fernet encryption/decryption module for API keys (`app/services/encryption.py`)
- [x] CRUD endpoints for user settings (`GET/PATCH /api/settings/me`)
- [x] CRUD endpoints for model sources and model lists (`/api/settings/sources/**`)
- [ ] LiteLLM service layer (wired in routers but needs integration tests with live keys)
- [x] Model list sync from provider on source creation + manual refresh endpoint
- [x] SSE streaming endpoint (`POST /api/chats/{id}/branches/{id}/messages`)

---

## Phase 3: The Tangent Engine (Backend Chat Logic)
- [x] `chats`, `nodes`, `branches` adjacency list ORM models
- [x] Recursive CTE query for linear history retrieval (`app/services/history.py`)
- [x] Message insertion endpoint with node creation and SSE streaming
- [x] Custom instructions injected as system message
- [x] Context window token counting and budget enforcement
- [x] Streaming AI response via SSE (fetch + ReadableStream, `X-Node-Id` header)
- [x] Context compression / oldest-node summarization
- [x] Merge (synthesize-and-merge) endpoint (`POST /api/chats/{id}/branches/merge`)
- [x] Branch deletion with exclusive-node cascade logic (`_collect_exclusive_nodes`)
- [x] Background async chat title generation

---

## Phase 4: Frontend Chat Interface
- [x] Dual-pane app shell layout (`AppShell`, `Sidebar`)
- [x] Dark theme base (Tailwind CSS v4, `bg-neutral-950`)
- [x] Light theme toggle (setting persisted, CSS class switching)
- [x] Sidebar: Chats tab (list, select, lazy new-chat UX)
- [x] Settings page (model sources CRUD, custom instructions, theme, branch naming, share links)
- [x] Linear chat history component (`MessageList` with streaming in-place)
- [x] Message input bar with inline model picker dropdown
- [x] Send / Branch button toggle logic (HEAD vs non-HEAD node) — `MessageInput`
- [x] SSE consumer for streaming AI responses (`useStream` hook, fetch + ReadableStream)
- [x] Context compression review/edit UI element

---

## Phase 5: React Flow Graph & Branching UI
- [x] Backend endpoint: flat node list with branch metadata (`GET /api/chats/{id}/graph`)
- [x] Frontend graph data transformer (nodes + edges for React Flow)
- [x] `dagre` top-to-bottom layout (`GraphView`, `buildDagreLayout`)
- [x] Unlabelled dot node renderer (`CommitDotNode`)
- [x] Branch-origin node visual distinction (larger indigo dot)
- [x] Hover tooltip showing branch name(s)
- [x] Node click → switch right-pane to that node's timeline
- [x] Sidebar Graph tab integration

---

## Phase 6: Polish & Advanced Features
- [x] Async chat title generation (background LLM call on first message)
- [x] Share links: DB table, generation endpoint, public read-only view (`/share/view/{token}`)
- [x] Active share links management in Settings (list + revoke)
- [ ] Share link full-app read-only mode (`share_view_mode=full`)
- [x] Configurable keybindings (Ctrl+K/J/L graph navigation, etc.)
- [x] Branch naming mode setting (random `wispy-river-42` vs AI) — stored in user settings, random name generator in `branches.py`
- [x] Pytest backend test suite
- [x] Vitest frontend unit tests
- [ ] Playwright E2E tests
- [x] `tox` / `tox-uv` CI configuration (in `pyproject.toml`)
- [x] Docker Compose deployment setup
- [ ] Production deployment documentation
