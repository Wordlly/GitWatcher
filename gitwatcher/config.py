\
import os
from dataclasses import dataclass

from dotenv import load_dotenv

load_dotenv()


def _int_env(name: str, default: int | None = None) -> int | None:
    value = os.getenv(name)
    if not value:
        return default
    return int(value)


@dataclass(frozen=True)
class Settings:
    discord_token: str = os.getenv("DISCORD_TOKEN", "")
    discord_guild_id: int | None = _int_env("DISCORD_GUILD_ID")
    github_webhook_secret: str = os.getenv("GITHUB_WEBHOOK_SECRET", "")
    watched_repo: str = os.getenv("WATCHED_REPO", "")
    watched_branch: str = os.getenv("WATCHED_BRANCH", "main")
    log_channel_id: int | None = _int_env("LOG_CHANNEL_ID")
    database_path: str = os.getenv("DATABASE_PATH", "./gitwatcher.db")
    port: int = int(os.getenv("PORT", "8080"))


settings = Settings()

if not settings.discord_token:
    raise RuntimeError("DISCORD_TOKEN is required.")
if not settings.github_webhook_secret:
    raise RuntimeError("GITHUB_WEBHOOK_SECRET is required.")
if not settings.watched_repo:
    raise RuntimeError("WATCHED_REPO is required (example: owner/WLPT).")
