from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

EMBEDDING_DIMENSION = 1024


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
    embedding_model: str = "BAAI/bge-m3"
    embedding_revision: str = Field(
        default="5617a9f61b028005a4858fdac845db406aefb181", pattern=r"^[0-9a-f]{40}$"
    )
    embedding_max_tokens: int = Field(default=8192, ge=16, le=8192)
    embedding_batch_size: int = Field(default=4, ge=1, le=16)
    embedding_batch_chars: int = Field(default=12000, ge=1000, le=64000)
    embedding_max_chunks: int = Field(default=128, ge=1, le=1024)
    embedding_max_text_chars: int = Field(default=6000, ge=1, le=16000)
    ai_provider: Literal["ollama", "freellmapi"] = "ollama"
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

    @model_validator(mode="after")
    def validate_chunk_sizes(self) -> "Settings":
        if self.material_chunk_overlap_chars >= self.material_chunk_target_chars:
            raise ValueError("Chunk overlap must be smaller than target size")
        return self

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")
