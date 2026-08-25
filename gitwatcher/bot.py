\
import discord
from discord import app_commands
from discord.ext import commands

from .config import settings
from . import db
from .views import TicketView, ticket_embed, ticket_view, refresh_ticket_message


intents = discord.Intents.default()
intents.guilds = True
intents.members = True

gitwatcher = app_commands.Group(name="gitwatcher", description="GitWatcher ticket commands")


def admin_only(interaction: discord.Interaction) -> bool:
    perms = interaction.user.guild_permissions
    return perms.manage_guild or perms.administrator


class GitWatcherBot(commands.Bot):
    async def setup_hook(self):
        db.init_db()

        # Persistent component handlers: old ticket buttons continue to work
        # after the process/container restarts.
        self.add_view(TicketView())
        self.tree.add_command(gitwatcher)

        # Guild sync is immediate and ideal for a small private V1.
        if settings.discord_guild_id:
            guild = discord.Object(id=settings.discord_guild_id)
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
            print(f"Synced commands to guild {settings.discord_guild_id}")
        else:
            await self.tree.sync()
            print("Synced commands globally")


bot = GitWatcherBot(command_prefix="!", intents=intents)


@gitwatcher.command(name="assign", description="Assign a ticket to one person.")
@app_commands.describe(user="Discord user", description="Ticket description")
async def assign(
    interaction: discord.Interaction,
    user: discord.Member,
    description: str,
):
    if not admin_only(interaction):
        return await interaction.response.send_message(
            "You need Manage Server permission to assign tickets.", ephemeral=True
        )
    if not interaction.guild_id or not interaction.channel_id:
        return await interaction.response.send_message("Use this in a server channel.", ephemeral=True)

    ticket = db.create_ticket(
        guild_id=interaction.guild_id,
        channel_id=interaction.channel_id,
        title=description.strip(),
        created_by=interaction.user.id,
        assignee_ids=[user.id],
        max_assignees=1,
        ffa=False,
    )

    await interaction.response.send_message(embed=ticket_embed(ticket), view=ticket_view(ticket))
    message = await interaction.original_response()
    db.set_message_id(ticket["id"], message.id)


@gitwatcher.command(name="ffa", description="Create a free-assignment ticket.")
@app_commands.describe(description="Ticket description", slots="Number of people who can accept")
async def ffa(
    interaction: discord.Interaction,
    description: str,
    slots: app_commands.Range[int, 1, 10],
):
    if not admin_only(interaction):
        return await interaction.response.send_message(
            "You need Manage Server permission to create FFA tickets.", ephemeral=True
        )
    if not interaction.guild_id or not interaction.channel_id:
        return await interaction.response.send_message("Use this in a server channel.", ephemeral=True)

    ticket = db.create_ticket(
        guild_id=interaction.guild_id,
        channel_id=interaction.channel_id,
        title=description.strip(),
        created_by=interaction.user.id,
        assignee_ids=[],
        max_assignees=slots,
        ffa=True,
    )

    await interaction.response.send_message(embed=ticket_embed(ticket), view=ticket_view(ticket))
    message = await interaction.original_response()
    db.set_message_id(ticket["id"], message.id)


@gitwatcher.command(name="link", description="Link your Discord account to your GitHub username.")
@app_commands.describe(github_username="Your GitHub username")
async def link(interaction: discord.Interaction, github_username: str):
    db.link_user(interaction.user.id, github_username)
    await interaction.response.send_message(
        f"Linked <@{interaction.user.id}> to GitHub `{github_username}`.",
        ephemeral=True,
    )


@gitwatcher.command(name="transfer", description="Transfer a manual ticket to another user.")
@app_commands.describe(ticket_code="Example: GW-0001", user="New assignee")
async def transfer(
    interaction: discord.Interaction,
    ticket_code: str,
    user: discord.Member,
):
    if not admin_only(interaction):
        return await interaction.response.send_message(
            "You need Manage Server permission to transfer tickets.", ephemeral=True
        )
    ticket = db.get_ticket_by_code(ticket_code)
    if not ticket:
        return await interaction.response.send_message("Ticket not found.", ephemeral=True)
    if not db.transfer_ticket(ticket["id"], user.id):
        return await interaction.response.send_message(
            "Only manual-assignment tickets can be transferred in V1.", ephemeral=True
        )
    await refresh_ticket_message(bot, ticket["id"])
    await interaction.response.send_message(
        f"{ticket['code']} transferred to {user.mention}.", ephemeral=True
    )


@gitwatcher.command(name="status", description="Show the repository GitWatcher is monitoring.")
async def status(interaction: discord.Interaction):
    await interaction.response.send_message(
        f"Watching `{settings.watched_repo}` → `{settings.watched_branch}` only.",
        ephemeral=True,
    )


@bot.event
async def on_ready():
    print(f"Logged in as {bot.user} ({bot.user.id if bot.user else 'unknown'})")
