from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_env: str = "development"
    frontend_url: str = "http://localhost:3000"
    database_url: str = "postgresql+psycopg://examprep:examprep@localhost:5432/examprep"
    session_secret: str = "development-only-change-me"
    session_max_age_seconds: int = 3600
    session_cookie_name: str = "examprep_session"
    session_cookie_secure: bool = False

    model_config = SettingsConfigDict(env_file=("../.env", ".env"), extra="ignore")
