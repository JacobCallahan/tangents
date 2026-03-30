# Tangents

AI chat with Git-like branching history. Explore divergent conversation lines with any LLM, synthesize side-threads back to main, and visualise your full conversation tree.

## Quick Start

### Prerequisites
- Python 3.12+ with [uv](https://github.com/astral-sh/uv)
- Node.js 20+

### Backend

```bash
cd backend

# Copy and configure environment
cp .env.example .env
# Edit .env: set ENCRYPTION_KEY (generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())")

# Run database migrations
uv run alembic upgrade head

# Start development server
uv run uvicorn app.main:app --reload --port 8000
```

API docs available at http://localhost:8000/docs

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App available at http://localhost:5173

Default credentials: `admin` / `tangents`

---

## Architecture

```
tangents/
├── backend/               # FastAPI + SQLAlchemy + LiteLLM
│   ├── app/
│   │   ├── main.py        # FastAPI app entry point
│   │   ├── config.py      # Settings (pydantic-settings, .env)
│   │   ├── database.py    # Async SQLAlchemy engine + session
│   │   ├── models.py      # ORM models (adjacency list)
│   │   ├── schemas.py     # Pydantic DTOs
│   │   ├── dependencies.py  # Auth (basic / JWT)
│   │   ├── routers/
│   │   │   ├── chats.py        # Chat CRUD + graph data
│   │   │   ├── branches.py     # Branch CRUD + SSE streaming + merge
│   │   │   ├── settings.py     # Model sources + user settings
│   │   │   └── share_links.py  # Share link generation + public view
│   │   └── services/
│   │       ├── encryption.py   # Fernet API key encryption
│   │       └── history.py      # Recursive CTE for linear history
│   ├── alembic/           # Database migrations
│   └── tests/
├── frontend/              # Vite + React + TypeScript
│   └── src/
│       ├── api/           # Axios API client modules
│       ├── components/
│       │   ├── layout/    # AppShell, Sidebar
│       │   ├── chat/      # ChatView, MessageList, MessageInput, ModelPicker
│       │   ├── graph/     # React Flow graph (CommitDotNode, GraphView)
│       │   └── settings/  # SettingsPage
│       ├── hooks/         # useChat, useStream
│       ├── store/         # Zustand global state
│       └── types/         # TypeScript interfaces (mirrors backend DTOs)
└── tasks.md               # Implementation progress tracker
```

## Environment Variables

### Backend (`backend/.env`)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite+aiosqlite:///./tangents.db` | DB connection string |
| `ENCRYPTION_KEY` | *(required)* | Fernet key for API key encryption |
| `AUTH_MODE` | `basic` | `basic` (single-user) or `strict` (JWT multi-user) |
| `ADMIN_USERNAME` | `admin` | Username for basic auth |
| `ADMIN_PASSWORD` | `tangents` | Password for basic auth |
| `SYNTHESIS_MODEL` | *(none)* | Default model for merge/compression |
| `SECRET_KEY` | `changeme-in-production` | JWT signing key (strict mode) |

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Python, FastAPI, SQLAlchemy (async), Alembic |
| AI | LiteLLM (OpenAI, Anthropic, Gemini, Ollama, …) |
| Database | SQLite (default) → PostgreSQL (set `DATABASE_URL`) |
| Encryption | Fernet symmetric encryption (`cryptography`) |
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4 |
| Graph | React Flow (@xyflow/react), Dagre auto-layout |
| State | Zustand, TanStack Query |
| Testing | pytest, Vitest, Playwright |
