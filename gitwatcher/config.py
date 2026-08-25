
import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

def _int_env(name: str, default=None):
    value = os.getenv(name)
    return int(value) if value else default

@dataclass(frozen=True)
class Settings:
    discord_token: str = os.getenv("DISCORD_TOKEN", "")
    discord_guild_id: int | None = _int_env("DISCORD_GUILD_ID")
    log_channel_id: int | None = _int_env("LOG_CHANNEL_ID")
    database_url: str = os.getenv("DATABASE_URL", "")
    github_token: str = os.getenv("GITHUB_TOKEN", "")
    poll_seconds: int = int(os.getenv("POLL_SECONDS", "300"))
    port: int = int(os.getenv("PORT", "8080"))

settings = Settings()

missing = [
    name for name, value in {
        "DISCORD_TOKEN": settings.discord_token,
        "DATABASE_URL": settings.database_url,
    }.items() if not value
]
if missing:
    raise RuntimeError(f"Missing required environment variables: {', '.join(missing)}")
