from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    frontend_url: str = "http://localhost:3000"
    database_url: str = "postgresql+psycopg://examprep:examprep@localhost:5432/examprep"

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")
