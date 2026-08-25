import discord
from discord import app_commands
from ..database import repositories as repo_db
from ..services.github import parse_github_profile, get_user, guild_token

def register(group: app_commands.Group):
    @group.command(name="setuser", description="Link your Discord account to your GitHub account.")
    @app_commands.describe(github="GitHub username or profile URL")
    async def setuser(interaction: discord.Interaction, github: str):
        if not interaction.guild_id:
            return await interaction.response.send_message("Use this inside a Discord server.", ephemeral=True)
        await interaction.response.defer(ephemeral=True)
        try:
            username = parse_github_profile(github)
            user = await get_user(username, token=guild_token(interaction.guild_id))
        except Exception as exc:
            return await interaction.followup.send(f"❌ {exc}", ephemeral=True)
        ok, owner_discord_id = repo_db.set_github_user(
            interaction.guild_id, interaction.user.id, int(user["id"]), user["login"]
        )
        if not ok:
            return await interaction.followup.send(
                f"❌ GitHub `{user['login']}` is already linked to <@{owner_discord_id}> in this server.",
                ephemeral=True,
            )
        await interaction.followup.send(f"✅ You are linked to GitHub `{user['login']}`.", ephemeral=True)

    @group.command(name="whoami", description="Show your GitHub account for this Discord server.")
    async def whoami(interaction: discord.Interaction):
        user = repo_db.get_github_user_for_discord(interaction.guild_id, interaction.user.id)
        if not user:
            return await interaction.response.send_message("You have not linked GitHub yet. Use `/gitwatcher setuser`.", ephemeral=True)
        await interaction.response.send_message(f"You are linked to GitHub `{user['github_login']}`.", ephemeral=True)
