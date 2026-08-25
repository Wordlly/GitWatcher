import asyncio
import discord
from discord import app_commands
from discord.ext import commands
from .commands import auth, users, repos, tickets, help as help_commands
from .database.schema import init_db
from .services.watcher import watcher_loop
from .ui.tickets import TicketView

intents = discord.Intents.default()
intents.guilds = True

gitwatcher = app_commands.Group(name="gitwatcher", description="Track GitHub development tasks from Discord.")
auth.register(gitwatcher)
users.register(gitwatcher)
repos.register(gitwatcher)
tickets.register(gitwatcher)
help_commands.register(gitwatcher)

class GitWatcherBot(commands.Bot):
    async def setup_hook(self):
        init_db()
        self.add_view(TicketView())
        self.tree.add_command(gitwatcher)
        await self.tree.sync()
        self.watcher_task = asyncio.create_task(watcher_loop(self))

bot = GitWatcherBot(command_prefix="!", intents=intents)

@bot.event
async def on_ready():
    print(f"GitWatcher online as {bot.user}")
