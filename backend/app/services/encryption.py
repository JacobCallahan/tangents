"""
Fernet symmetric encryption for API keys stored in the database.
Keys are write-only from the UI perspective — they cannot be read back,
only replaced or deleted.

The ENCRYPTION_KEY env var must contain a URL-safe base64-encoded 32-byte key.
Generate one with:
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""

from cryptography.fernet import Fernet, InvalidToken
from fastapi import HTTPException, status

from app.config import settings


def _get_fernet() -> Fernet:
    if not settings.ENCRYPTION_KEY:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "ENCRYPTION_KEY environment variable is not set. "
                "API key storage is unavailable."
            ),
        )
    return Fernet(settings.ENCRYPTION_KEY.encode())


def encrypt_api_key(plaintext: str) -> str:
    """Encrypt a plaintext API key and return the ciphertext as a string."""
    f = _get_fernet()
    return f.encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    """Decrypt a stored API key ciphertext.  Raises HTTP 500 on failure."""
    f = _get_fernet()
    try:
        return f.decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to decrypt API key. The ENCRYPTION_KEY may have changed.",
        ) from exc
