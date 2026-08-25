import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()

@dataclass(frozen=True)
class Settings:
    discord_token: str = os.getenv("DISCORD_TOKEN", "")
    database_url: str = os.getenv("DATABASE_URL", "")
    encryption_key: str = os.getenv("GITWATCHER_ENCRYPTION_KEY", "")
    poll_seconds: int = max(int(os.getenv("POLL_SECONDS", "300")), 60)
    port: int = int(os.getenv("PORT", "8080"))

settings = Settings()
missing = [name for name, value in {
    "DISCORD_TOKEN": settings.discord_token,
    "DATABASE_URL": settings.database_url,
    "GITWATCHER_ENCRYPTION_KEY": settings.encryption_key,
}.items() if not value]
if missing:
    raise RuntimeError("Missing required environment variables: " + ", ".join(missing))
