import re
from pathlib import Path
from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, SecretStr, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

EMBEDDING_DIMENSION = 1024


class Settings(BaseSettings):
    app_env: Literal["development", "test", "staging", "production"] = "development"
    frontend_url: str = "http://localhost:3000"
    database_url: str = Field(
        default="postgresql+psycopg://examprep:examprep@localhost:5432/examprep", repr=False
    )
    session_secret: str = Field(default="development-only-change-me", repr=False)
    # Sessions slide: an authenticated request past half this age gets a fresh cookie.
    session_max_age_seconds: int = 14400
    session_cookie_name: str = "examprep_session"
    session_cookie_secure: bool = False
    session_cookie_samesite: Literal["lax", "strict", "none"] = "lax"
    auth_rate_limit_mode: Literal["auto", "enabled", "disabled"] = "auto"
    auth_login_max_attempts: int = Field(default=10, ge=1, le=1000)
    auth_login_max_total_attempts: int = Field(default=100, ge=1, le=10000)
    auth_login_window_seconds: int = Field(default=60, ge=1, le=3600)
    auth_register_max_attempts: int = Field(default=5, ge=1, le=1000)
    auth_register_max_total_attempts: int = Field(default=20, ge=1, le=10000)
    auth_register_window_seconds: int = Field(default=600, ge=1, le=3600)
    # Google sign-in: the Web OAuth client ID (public, not a secret). Empty turns Google off.
    google_client_id: str = ""
    # Unset: password sign-in stays on without a Google client ID, and in development and test.
    # Kept out of repr: a setting named "password" must never look like a leaked one in logs.
    password_login_enabled: bool | None = Field(default=None, repr=False)
    material_storage_dir: Path = Path("data/materials")
    material_max_upload_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    material_chunk_target_chars: int = Field(default=2500, ge=2)
    material_chunk_overlap_chars: int = Field(default=250, ge=0)
    embedding_model: str = "BAAI/bge-m3"
    embedding_revision: str = Field(
        default="5617a9f61b028005a4858fdac845db406aefb181", pattern=r"^[0-9a-f]{40}$"
    )
    embedding_max_tokens: int = Field(default=8192, ge=16, le=8192)
    embedding_batch_size: int = Field(default=4, ge=1, le=16)
    embedding_batch_chars: int = Field(default=12000, ge=1000, le=64000)
    embedding_max_chunks: int = Field(default=128, ge=1, le=1024)
    embedding_max_text_chars: int = Field(default=6000, ge=1, le=16000)
    ai_provider: Literal["ollama", "freellmapi", "openai_compatible", "disabled"] = "ollama"
    openai_compatible_url: str = ""
    openai_compatible_model: str = ""
    openai_compatible_api_key: SecretStr = SecretStr("")
    question_import_max_bytes: int = Field(default=2097152, ge=1, le=2097152)
    question_import_max_count: int = Field(default=500, ge=1, le=500)
    question_generation_max_count: int = Field(default=10, ge=1, le=10)
    question_generation_max_concepts: int = Field(default=5, ge=1, le=5)
    question_generation_retrieval_top_k_max: int = Field(default=10, ge=1, le=10)
    question_generation_max_context_chunks: int = Field(default=12, ge=1, le=12)
    question_generation_max_context_chars: int = Field(default=16000, ge=1000, le=16000)
    freellmapi_url: str = "http://localhost:3001/v1"
    freellmapi_api_key: SecretStr = SecretStr("")
    freellmapi_model: str = "auto"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3:4b"
    ai_request_timeout_seconds: float = Field(default=120, gt=0, le=600)
    ai_max_input_chars: int = Field(default=12000, ge=2000, le=100000)
    ai_concept_chunks_per_request: int = Field(default=3, ge=1, le=32)
    ai_max_batches: int = Field(default=32, ge=1, le=128)

    @field_validator("database_url")
    @classmethod
    def postgres_driver(cls, value: str) -> str:
        for prefix in ("postgres://", "postgresql://"):
            if value.startswith(prefix):
                value = "postgresql+psycopg://" + value[len(prefix) :]
        if not value.startswith("postgresql+psycopg://"):
            raise ValueError("DATABASE_URL must use PostgreSQL with psycopg")
        return value

    @field_validator("frontend_url")
    @classmethod
    def explicit_origin(cls, value: str) -> str:
        value = value.rstrip("/")
        parsed = urlsplit(value)
        if (
            parsed.scheme not in ("http", "https")
            or not parsed.hostname
            or "*" in value
            or parsed.username
            or parsed.password
            or parsed.path
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("FRONTEND_URL must be one explicit HTTP(S) origin")
        return value

    @field_validator("google_client_id")
    @classmethod
    def google_web_client(cls, value: str) -> str:
        value = value.strip()
        if value and not re.fullmatch(r"[0-9A-Za-z._-]+\.apps\.googleusercontent\.com", value):
            raise ValueError("GOOGLE_CLIENT_ID must be a Google OAuth client ID")
        return value

    @field_validator("password_login_enabled", mode="before")
    @classmethod
    def blank_means_unset(cls, value: object) -> object:
        return None if isinstance(value, str) and not value.strip() else value

    @property
    def password_login(self) -> bool:
        """Whether password sign-in and registration are open."""
        if self.password_login_enabled is not None:
            return self.password_login_enabled
        return not self.google_client_id or self.app_env in ("development", "test")

    @model_validator(mode="after")
    def deployment_safety(self) -> "Settings":
        if self.session_cookie_samesite == "none" and not self.session_cookie_secure:
            raise ValueError("SameSite=None requires Secure cookies")
        if self.app_env in ("staging", "production"):
            from sqlalchemy.engine import make_url

            if (
                len(self.session_secret) < 32
                or "replace" in self.session_secret.lower()
                or self.session_secret == "development-only-change-me"
            ):
                raise ValueError("Set a random SESSION_SECRET of at least 32 characters")
            if not self.session_cookie_secure or not self.frontend_url.startswith("https://"):
                raise ValueError("Hosted environments require HTTPS frontend and Secure cookies")
            if make_url(self.database_url).query.get("sslmode") not in ("require", "verify-full"):
                raise ValueError("Hosted DATABASE_URL requires sslmode=require or verify-full")
            if self.ai_provider != "disabled":
                if self.ai_provider != "openai_compatible":
                    raise ValueError(
                        "Hosted environments require explicit openai_compatible provider"
                    )
                if (
                    not self.openai_compatible_model.strip()
                    or not self.openai_compatible_api_key.get_secret_value().strip()
                ):
                    raise ValueError("Configure the staging AI model and API key")
                from app.services.ai.providers.openai_compatible import validate_https_url

                validate_https_url(self.openai_compatible_url)
            if not self.material_storage_dir.is_absolute():
                raise ValueError(
                    "Hosted MATERIAL_STORAGE_DIR must be an absolute mounted volume path"
                )
        return self

    @model_validator(mode="after")
    def validate_chunk_sizes(self) -> "Settings":
        if self.material_chunk_overlap_chars >= self.material_chunk_target_chars:
            raise ValueError("Chunk overlap must be smaller than target size")
        return self

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"), extra="ignore", hide_input_in_errors=True
    )
