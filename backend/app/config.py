from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Optional


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Database
    DATABASE_URL: str = "sqlite+aiosqlite:///./tangents.db"

    # Encryption (Fernet key — operators must set this in production)
    ENCRYPTION_KEY: Optional[str] = None

    # Authentication
    AUTH_MODE: str = "basic"  # "basic" or "strict"
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "tangents"

    # JWT (used when AUTH_MODE=strict)
    SECRET_KEY: str = "changeme-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 1 week

    # AI
    SYNTHESIS_MODEL: Optional[str] = None

    # Branch naming
    BRANCH_NAMING_MODE: str = "random"  # "random" or "ai"


settings = Settings()
