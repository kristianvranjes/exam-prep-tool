from pathlib import Path
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    frontend_url: str = "http://localhost:3000"
    database_url: str = "postgresql+psycopg://examprep:examprep@localhost:5432/examprep"
    session_secret: str = "development-only-change-me"
    session_max_age_seconds: int = 3600
    session_cookie_name: str = "examprep_session"
    session_cookie_secure: bool = False
    material_storage_dir: Path = Path("data/materials")
    material_max_upload_bytes: int = Field(default=20 * 1024 * 1024, gt=0)
    material_chunk_target_chars: int = Field(default=2500, ge=2)
    material_chunk_overlap_chars: int = Field(default=250, ge=0)
    ai_provider: Literal["ollama"] = "ollama"
    ollama_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3:4b"
    ai_request_timeout_seconds: float = Field(default=120, gt=0, le=600)
    ai_max_input_chars: int = Field(default=12000, ge=2000, le=100000)
    ai_concept_chunks_per_request: int = Field(default=3, ge=1, le=32)
    ai_max_batches: int = Field(default=32, ge=1, le=128)

    @model_validator(mode="after")
    def validate_chunk_sizes(self) -> "Settings":
        if self.material_chunk_overlap_chars >= self.material_chunk_target_chars:
            raise ValueError("Chunk overlap must be smaller than target size")
        return self

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")
