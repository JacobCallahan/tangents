# ── Backend Dockerfile ──────────────────────────────────────────────────────
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim

WORKDIR /app

# Install the Python version required by the project (3.14) at build time
# so the venv symlinks are stable and nothing is downloaded at container startup
RUN uv python install 3.14

# Copy dependency manifests first (layer-cache friendly)
COPY pyproject.toml uv.lock ./

# Install production deps into /app/.venv using the pinned Python
RUN uv sync --frozen --no-dev

# Copy the rest of the source
COPY . .

# Put the venv on PATH so alembic/uvicorn are callable directly
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    DATABASE_URL="sqlite+aiosqlite:////data/tangents.db"

# Persist SQLite database to a volume
VOLUME ["/data"]

EXPOSE 8000

# Run migrations then start the server
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]

