import asyncio
import uvicorn
from .bot import bot
from .config import settings
from .database.connection import close_pool
from .web import app

async def run_web():
    server = uvicorn.Server(uvicorn.Config(app, host="0.0.0.0", port=settings.port, log_level="info"))
    await server.serve()

async def main():
    try:
        async with bot:
            await asyncio.gather(bot.start(settings.discord_token), run_web())
    finally:
        close_pool()

if __name__ == "__main__":
    asyncio.run(main())
