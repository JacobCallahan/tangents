# Tangents — project automation
# Usage: make <target>
#
# Prerequisites:
#   Backend  — uv (https://github.com/astral-sh/uv)
#   Frontend — node / npm ≥ 22
#   Deploy   — docker + docker compose

.PHONY: help setup setup-backend setup-frontend setup-playwright \
        test test-backend test-frontend test-frontend-watch test-frontend-ui \
        test-frontend-record test-e2e test-live \
        lint lint-backend lint-frontend \
        build build-local build-backend build-frontend build-no-cache \
        dev dev-backend dev-frontend \
        deploy deploy-up deploy-down deploy-restart deploy-logs \
        clean

# ── Defaults ────────────────────────────────────────────────────────────────

BACKEND_DIR   := backend
FRONTEND_DIR  := frontend
COMPOSE       := docker compose

# Colour helpers (degraded gracefully when not in a terminal)
BOLD  := $(shell tput bold 2>/dev/null || echo '')
RESET := $(shell tput sgr0 2>/dev/null || echo '')
GREEN := $(shell tput setaf 2 2>/dev/null || echo '')
CYAN  := $(shell tput setaf 6 2>/dev/null || echo '')

help:  ## Show this help message
	@echo ""
	@echo "$(BOLD)Tangents — available targets$(RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*##' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*##"}; {printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2}'
	@echo ""

# ── Setup ───────────────────────────────────────────────────────────────────

setup: setup-backend setup-frontend setup-playwright  ## Install all dependencies

setup-backend:  ## Install backend Python deps (dev group included)
	@echo "$(GREEN)▶ Installing backend dependencies…$(RESET)"
	cd $(BACKEND_DIR) && uv sync --group dev

setup-frontend:  ## Install frontend npm deps
	@echo "$(GREEN)▶ Installing frontend dependencies…$(RESET)"
	cd $(FRONTEND_DIR) && npm ci

setup-playwright:  ## Install Playwright browsers for E2E tests
	@echo "$(GREEN)▶ Installing Playwright browsers…$(RESET)"
	cd $(BACKEND_DIR) && uv run playwright install --with-deps chromium

# ── Tests ────────────────────────────────────────────────────────────────────

test: test-backend test-frontend  ## Run all non-E2E tests

test-backend:  ## Run Python unit tests (pytest, in-memory SQLite)
	@echo "$(GREEN)▶ Running backend unit tests…$(RESET)"
	cd $(BACKEND_DIR) && uv run pytest tests/ -v --ignore=tests/e2e

test-frontend:  ## Run frontend Vitest unit tests
	@echo "$(GREEN)▶ Running frontend unit tests…$(RESET)"
	cd $(FRONTEND_DIR) && npm run test:run

test-frontend-watch:  ## Run frontend Vitest in watch mode
	cd $(FRONTEND_DIR) && npm run test

test-frontend-ui:  ## Open Vitest UI in browser
	cd $(FRONTEND_DIR) && npm run test -- --ui

test-frontend-record:  ## Update Vitest snapshots (re-record failing snapshot baselines)
	@echo "$(GREEN)▶ Updating frontend test snapshots…$(RESET)"
	cd $(FRONTEND_DIR) && npm run test:run -- --update

test-e2e:  ## Run Playwright E2E tests against a local server (no real LLM)
	@echo "$(GREEN)▶ Running E2E tests…$(RESET)"
	cd $(BACKEND_DIR) && uv run pytest tests/e2e/ -v -m "not live_llm"

test-live:  ## Run live LLM functional tests (requires .env with LIVE_LLM_TESTS=1 + API keys)
	@echo "$(GREEN)▶ Running live LLM tests (reads .env)…$(RESET)"
	@if [ ! -f $(BACKEND_DIR)/.env ]; then \
		echo "  $(BOLD)ERROR$(RESET): $(BACKEND_DIR)/.env not found."; \
		echo "  Create it with LIVE_LLM_TESTS=1 and at least one API key."; \
		exit 1; \
	fi
	cd $(BACKEND_DIR) && uv run pytest tests/e2e/test_live_llm.py -v -m live_llm

# ── Lint ────────────────────────────────────────────────────────────────────

lint: lint-backend lint-frontend  ## Run all linters

lint-backend:  ## Ruff lint + format check
	@echo "$(GREEN)▶ Linting backend…$(RESET)"
	cd $(BACKEND_DIR) && uv run ruff check . && uv run ruff format --check .

lint-frontend:  ## ESLint
	@echo "$(GREEN)▶ Linting frontend…$(RESET)"
	cd $(FRONTEND_DIR) && npm run lint

# ── Build ────────────────────────────────────────────────────────────────────

build: build-backend build-frontend  ## Build both Docker images

build-backend:  ## Build backend Docker image only
	@echo "$(GREEN)▶ Building backend image…$(RESET)"
	$(COMPOSE) build backend

build-frontend:  ## Build frontend Docker image only
	@echo "$(GREEN)▶ Building frontend image…$(RESET)"
	$(COMPOSE) build frontend

build-no-cache:  ## Rebuild all Docker images without cache
	$(COMPOSE) build --no-cache

build-local:  ## Compile TypeScript + bundle with Vite (local, no Docker)
	@echo "$(GREEN)▶ Building frontend locally (tsc + vite)…$(RESET)"
	cd $(FRONTEND_DIR) && npm run build

# ── Dev ─────────────────────────────────────────────────────────────────────

dev:  ## Start backend + frontend dev servers (blocking, Ctrl-C to stop both)
	@echo "$(GREEN)▶ Starting dev servers (backend :8000, frontend :5173)…$(RESET)"
	@trap 'kill %1 %2' INT; \
		(cd $(BACKEND_DIR) && uv run uvicorn app.main:app --reload --port 8000) & \
		(cd $(FRONTEND_DIR) && npm run dev) & \
		wait

dev-backend:  ## Start only the backend dev server
	cd $(BACKEND_DIR) && uv run uvicorn app.main:app --reload --port 8000

dev-frontend:  ## Start only the Vite dev server
	cd $(FRONTEND_DIR) && npm run dev

# ── Deploy ───────────────────────────────────────────────────────────────────

deploy: build deploy-up  ## Build and start all services via Docker Compose

deploy-up:  ## Start all services (detached)
	@echo "$(GREEN)▶ Starting services…$(RESET)"
	$(COMPOSE) up -d

deploy-down:  ## Stop and remove all services
	$(COMPOSE) down

deploy-restart:  ## Restart all services
	$(COMPOSE) restart

deploy-logs:  ## Tail logs for all services
	$(COMPOSE) logs -f

deploy-logs-backend:  ## Tail backend logs only
	$(COMPOSE) logs -f backend

deploy-logs-frontend:  ## Tail frontend (nginx) logs only
	$(COMPOSE) logs -f frontend

# ── Clean ────────────────────────────────────────────────────────────────────

clean:  ## Remove build artefacts and temp files
	@echo "$(GREEN)▶ Cleaning…$(RESET)"
	rm -rf $(FRONTEND_DIR)/dist
	find . -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name .pytest_cache -exec rm -rf {} + 2>/dev/null || true
	find . -name "*.pyc" -delete 2>/dev/null || true
