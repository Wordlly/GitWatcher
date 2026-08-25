import discord
from discord import app_commands
from ..database import repositories as repo_db
from ..services.github import parse_repository_url, validate_repository

def is_admin(interaction):
    p = interaction.user.guild_permissions
    return p.manage_guild or p.administrator

def register(group: app_commands.Group):
    @group.command(name="watch", description="Watch a GitHub repository in this channel.")
    @app_commands.describe(repository="GitHub repository URL")
    async def watch(interaction: discord.Interaction, repository: str):
        if not is_admin(interaction):
            return await interaction.response.send_message("You need Manage Server permission.", ephemeral=True)
        await interaction.response.defer()
        try:
            owner, repo = parse_repository_url(repository)
            checked = await validate_repository(interaction.guild_id, owner, repo)
        except Exception as exc:
            return await interaction.followup.send(f"❌ {exc}", ephemeral=True)
        saved = repo_db.add_repository(
            interaction.guild_id,
            interaction.channel_id,
            checked["owner"],
            checked["repo"],
            checked["is_private"],
            checked["head_sha"],
            interaction.user.id,
        )
        privacy = "private" if saved["is_private"] else "public"
        await interaction.followup.send(f"👀 Watching `{saved['owner']}/{saved['repo']}` → `main` ({privacy}) in this channel.")

    @group.command(name="unwatch", description="Stop watching the repository in this channel.")
    async def unwatch(interaction: discord.Interaction):
        if not is_admin(interaction):
            return await interaction.response.send_message("You need Manage Server permission.", ephemeral=True)
        removed = repo_db.remove_repository_for_channel(interaction.guild_id, interaction.channel_id)
        await interaction.response.send_message("Stopped watching this channel's repository." if removed else "This channel is not watching a repository.", ephemeral=True)

    @group.command(name="repos", description="Show repositories watched by this server.")
    async def repos(interaction: discord.Interaction):
        rows = repo_db.list_repositories(interaction.guild_id)
        if not rows:
            return await interaction.response.send_message("This server is not watching any repositories yet.", ephemeral=True)
        lines = [f"• <#{r['channel_id']}> → `{r['owner']}/{r['repo']}` (`main`)" for r in rows]
        await interaction.response.send_message("\n".join(lines), ephemeral=True)
