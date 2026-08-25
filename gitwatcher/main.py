\
import asyncio

import uvicorn

from .bot import bot
from .config import settings
from .webhook import app, install_routes


async def run_web():
    config = uvicorn.Config(
        app,
        host="0.0.0.0",
        port=settings.port,
        log_level="info",
    )
    server = uvicorn.Server(config)
    await server.serve()


async def main():
    install_routes(bot)

    async with bot:
        await asyncio.gather(
            bot.start(settings.discord_token),
            run_web(),
        )


if __name__ == "__main__":
    asyncio.run(main())
