from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./data/market_risk.db"
    allowed_origins: str = "http://localhost:3000"
    market_data_cache_hours: int = 6

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="MARKET_RISK_",
        extra="ignore",
    )

    @property
    def origins(self) -> list[str]:
        return [value.strip() for value in self.allowed_origins.split(",") if value.strip()]

    def ensure_sqlite_directory(self) -> None:
        prefix = "sqlite:///"
        if not self.database_url.startswith(prefix):
            return
        raw_path = self.database_url.removeprefix(prefix)
        if raw_path == ":memory:":
            return
        Path(raw_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    return Settings()

