
import asyncio
import discord
from discord import app_commands
from discord.ext import commands
from .config import settings
from . import db
from .github_watcher import parse_github_repo_url, validate_repository, watcher_loop
from .views import TicketView, ticket_embed, ticket_view, refresh_ticket_message

intents = discord.Intents.default()
intents.guilds = True
intents.members = True

gitwatcher = app_commands.Group(name="gitwatcher", description="GitWatcher ticket commands")

def admin_only(interaction):
    p = interaction.user.guild_permissions
    return p.manage_guild or p.administrator

def repo_for_channel(guild_id, channel_id):
    repos = db.list_repositories(guild_id)
    if len(repos) == 1:
        return repos[0]
    matches = [r for r in repos if r["channel_id"] == channel_id]
    return matches[0] if len(matches) == 1 else None

class GitWatcherBot(commands.Bot):
    async def setup_hook(self):
        db.init_db()
        self.add_view(TicketView())
        self.tree.add_command(gitwatcher)
        if settings.discord_guild_id:
            guild = discord.Object(id=settings.discord_guild_id)
            self.tree.copy_global_to(guild=guild)
            await self.tree.sync(guild=guild)
        else:
            await self.tree.sync()
        self.watcher_task = asyncio.create_task(watcher_loop(self))

bot = GitWatcherBot(command_prefix="!", intents=intents)

@gitwatcher.command(name="watch", description="Start watching a public GitHub repository.")
@app_commands.describe(repository_url="GitHub repository URL", branch="Branch to watch")
async def watch(interaction, repository_url: str, branch: str = "main"):
    if not admin_only(interaction):
        return await interaction.response.send_message(
            "You need Manage Server permission.", ephemeral=True)
    if not interaction.guild_id or not interaction.channel_id:
        return await interaction.response.send_message("Use this in a server channel.", ephemeral=True)

    await interaction.response.defer()
    try:
        owner, repo = parse_github_repo_url(repository_url)
        checked = await validate_repository(owner, repo, branch)
    except Exception as exc:
        return await interaction.followup.send(f"Could not watch that repository: {exc}", ephemeral=True)

    saved = db.add_repository(
        interaction.guild_id, interaction.channel_id,
        checked["owner"], checked["repo"], checked["branch"],
        interaction.user.id
    )
    db.set_last_seen_sha(saved["id"], checked["latest_sha"])
    await interaction.followup.send(
        f"👀 GitWatcher is now watching `{checked['owner']}/{checked['repo']}` "
        f"→ `{checked['branch']}`.\nNo webhook setup required.")

@gitwatcher.command(name="unwatch", description="Stop watching a GitHub repository.")
async def unwatch(interaction, repository_url: str):
    if not admin_only(interaction):
        return await interaction.response.send_message("You need Manage Server permission.", ephemeral=True)
    try:
        owner, repo = parse_github_repo_url(repository_url)
    except ValueError as exc:
        return await interaction.response.send_message(str(exc), ephemeral=True)
    removed = db.remove_repository(interaction.guild_id, owner, repo)
    await interaction.response.send_message(
        f"Stopped watching `{owner}/{repo}`." if removed else "That repository is not being watched.",
        ephemeral=True)

@gitwatcher.command(name="repos", description="List watched repositories.")
async def repos(interaction):
    rows = db.list_repositories(interaction.guild_id)
    text = "\n".join(f"• `{r['owner']}/{r['repo']}` → `{r['branch']}`" for r in rows)
    await interaction.response.send_message(text or "No repositories watched yet.", ephemeral=True)

@gitwatcher.command(name="assign", description="Assign a ticket to one person.")
async def assign(interaction, user: discord.Member, description: str):
    if not admin_only(interaction):
        return await interaction.response.send_message("You need Manage Server permission.", ephemeral=True)
    repository = repo_for_channel(interaction.guild_id, interaction.channel_id)
    if not repository:
        return await interaction.response.send_message(
            "I can't tell which repo this ticket belongs to. Use `/gitwatcher watch` "
            "in this channel, or keep one watched repo for now.", ephemeral=True)

    ticket = db.create_ticket(
        interaction.guild_id, interaction.channel_id, description.strip(),
        interaction.user.id, [user.id], 1, False, repository["id"])
    await interaction.response.send_message(embed=ticket_embed(ticket), view=ticket_view(ticket))
    message = await interaction.original_response()
    db.set_message_id(ticket["id"], message.id)

@gitwatcher.command(name="ffa", description="Create a free-assignment ticket.")
async def ffa(interaction, description: str, slots: app_commands.Range[int, 1, 10]):
    if not admin_only(interaction):
        return await interaction.response.send_message("You need Manage Server permission.", ephemeral=True)
    repository = repo_for_channel(interaction.guild_id, interaction.channel_id)
    if not repository:
        return await interaction.response.send_message(
            "I can't tell which repo this ticket belongs to. Use `/gitwatcher watch` "
            "in this channel, or keep one watched repo for now.", ephemeral=True)

    ticket = db.create_ticket(
        interaction.guild_id, interaction.channel_id, description.strip(),
        interaction.user.id, [], slots, True, repository["id"])
    await interaction.response.send_message(embed=ticket_embed(ticket), view=ticket_view(ticket))
    message = await interaction.original_response()
    db.set_message_id(ticket["id"], message.id)

@gitwatcher.command(name="link", description="Link your Discord account to GitHub once.")
async def link(interaction, github_username: str):
    db.link_user(interaction.user.id, github_username)
    await interaction.response.send_message(
        f"Linked you to GitHub `{github_username}`.", ephemeral=True)

@gitwatcher.command(name="transfer", description="Transfer a manual ticket.")
async def transfer(interaction, ticket_code: str, user: discord.Member):
    if not admin_only(interaction):
        return await interaction.response.send_message("You need Manage Server permission.", ephemeral=True)
    ticket = db.get_ticket_by_code(ticket_code)
    if not ticket:
        return await interaction.response.send_message("Ticket not found.", ephemeral=True)
    if not db.transfer_ticket(ticket["id"], user.id):
        return await interaction.response.send_message("FFA tickets cannot be transferred in V2.", ephemeral=True)
    await refresh_ticket_message(bot, ticket["id"])
    await interaction.response.send_message(
        f"{ticket['code']} transferred to {user.mention}.", ephemeral=True)

@gitwatcher.command(name="status", description="Show GitWatcher's current setup.")
async def status(interaction):
    repos = db.list_repositories(interaction.guild_id)
    text = "\n".join(f"👀 `{r['owner']}/{r['repo']}` → `{r['branch']}`" for r in repos)
    await interaction.response.send_message(text or "Online; no repositories watched yet.", ephemeral=True)



@gitwatcher.command(name="help", description="Show the GitWatcher help menu.")
async def help_command(interaction):
    embed = discord.Embed(
        title="GitWatcher Help",
        description="GitWatcher keeps track of development tasks without getting in your way.",
        colour=discord.Colour.blurple(),
    )

    embed.add_field(
        name="👀 Watch a repo",
        value=(
            "`/gitwatcher watch <github-url>`\n"
            "Example:\n"
            "`/gitwatcher watch https://github.com/owner/repo`"
        ),
        inline=False,
    )

    embed.add_field(
        name="🎫 Assign a task",
        value=(
            "`/gitwatcher assign @user \"Task description\"`\n"
            "The user presses **Accept Ticket**."
        ),
        inline=False,
    )

    embed.add_field(
        name="🙋 Free-for-all task",
        value=(
            "`/gitwatcher ffa \"Task description\" <slots>`\n"
            "Example: `/gitwatcher ffa \"Create Django repo\" 2`"
        ),
        inline=False,
    )

    embed.add_field(
        name="🔗 Link GitHub",
        value=(
            "`/gitwatcher link <github-username>`\n"
            "Each developer only needs to do this once."
        ),
        inline=False,
    )

    embed.add_field(
        name="✅ Complete a task",
        value=(
            "Commit using the same wording as the task.\n"
            "Capital letters do not matter.\n\n"
            "Task: `Setup development notes`\n"
            "Commit: `setup development notes` ✅"
        ),
        inline=False,
    )

    embed.add_field(
        name="📋 Other commands",
        value=(
            "`/gitwatcher repos` — show watched repos\n"
            "`/gitwatcher status` — show status\n"
            "`/gitwatcher unwatch <url>` — stop watching\n"
            "`/gitwatcher transfer <ticket> @user` — hand over a ticket"
        ),
        inline=False,
    )

    embed.set_footer(text="GitWatcher")
    await interaction.response.send_message(embed=embed, ephemeral=True)


@bot.event
async def on_ready():
    print(f"Logged in as {bot.user}")
