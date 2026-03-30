"""
FastAPI dependency injection for authentication.

Supports two modes controlled by the AUTH_MODE environment variable:

  AUTH_MODE=basic  (default)
      HTTP Basic Auth against ADMIN_USERNAME / ADMIN_PASSWORD env vars.
      All requests are attributed to a fixed single-user ID.

  AUTH_MODE=strict
      HTTP Bearer JWT token validation.
      Enables full multi-user SaaS with per-user data isolation.

No route code changes are required to switch modes.
"""

import secrets
from typing import Any

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials, HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt

from app.config import settings

# ---------------------------------------------------------------------------
# Security schemes
# ---------------------------------------------------------------------------

_basic_scheme = HTTPBasic(auto_error=False)
_bearer_scheme = HTTPBearer(auto_error=False)

# Fixed UUID for the single admin user in basic-auth mode
SINGLE_USER_ID = "00000000-0000-0000-0000-000000000000"
SINGLE_USER_NAME = settings.ADMIN_USERNAME


# ---------------------------------------------------------------------------
# Dependency: get_current_user
# ---------------------------------------------------------------------------


async def get_current_user(
    basic_credentials: HTTPBasicCredentials | None = Depends(_basic_scheme),
    bearer_credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> dict[str, Any]:
    """
    Returns a dict with at minimum ``id`` (str UUID) and ``username`` (str).
    Raise HTTP 401 if credentials are invalid or missing for the active mode.
    """
    if settings.AUTH_MODE == "basic":
        return _validate_basic(basic_credentials)
    elif settings.AUTH_MODE == "strict":
        return _validate_jwt(bearer_credentials)
    else:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Unknown AUTH_MODE: {settings.AUTH_MODE!r}",
        )


def _validate_basic(credentials: HTTPBasicCredentials | None) -> dict[str, Any]:
    if credentials is None:
        raise _unauthorized_basic()

    correct_username = secrets.compare_digest(
        credentials.username.encode(), settings.ADMIN_USERNAME.encode()
    )
    correct_password = secrets.compare_digest(
        credentials.password.encode(), settings.ADMIN_PASSWORD.encode()
    )

    if not (correct_username and correct_password):
        raise _unauthorized_basic()

    return {"id": SINGLE_USER_ID, "username": credentials.username}


def _validate_jwt(credentials: HTTPAuthorizationCredentials | None) -> dict[str, Any]:
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bearer token required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(
            credentials.credentials,
            settings.SECRET_KEY,
            algorithms=[settings.ALGORITHM],
        )
        user_id: str | None = payload.get("sub")
        username: str | None = payload.get("username")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid token payload",
                headers={"WWW-Authenticate": "Bearer"},
            )
        return {"id": user_id, "username": username or ""}
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Could not validate credentials: {exc}",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc


def _unauthorized_basic() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect username or password",
        headers={"WWW-Authenticate": "Basic"},
    )
