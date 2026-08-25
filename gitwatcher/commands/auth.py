import discord
from discord import app_commands
from ..database import repositories as repo_db
from ..services.encryption import encrypt_secret
from ..services.github import get_authenticated_user

def is_admin(interaction):
    p = interaction.user.guild_permissions
    return p.manage_guild or p.administrator

class GitHubTokenModal(discord.ui.Modal, title="Connect GitHub"):
    token = discord.ui.TextInput(
        label="GitHub token",
        placeholder="Paste your GitHub token",
        required=True,
        min_length=20,
        max_length=500,
    )

    async def on_submit(self, interaction):
        if not interaction.guild_id:
            return await interaction.response.send_message("Use this inside a server.", ephemeral=True)
        await interaction.response.defer(ephemeral=True)
        value = str(self.token).strip()
        try:
            user = await get_authenticated_user(value)
        except Exception as exc:
            return await interaction.followup.send(f"❌ I could not use that token: {exc}", ephemeral=True)
        repo_db.save_github_credential(
            interaction.guild_id,
            encrypt_secret(value),
            user["login"],
            int(user["id"]),
            interaction.user.id,
        )
        await interaction.followup.send(f"✅ GitHub access connected as `{user['login']}`.", ephemeral=True)

def register(group: app_commands.Group):
    @group.command(name="auth", description="Give this server access to private GitHub repositories.")
    async def auth(interaction: discord.Interaction):
        if not is_admin(interaction):
            return await interaction.response.send_message("You need Manage Server permission.", ephemeral=True)
        await interaction.response.send_modal(GitHubTokenModal())

    @group.command(name="auth-status", description="Check this server's GitHub access.")
    async def auth_status(interaction: discord.Interaction):
        credential = repo_db.get_github_credential(interaction.guild_id)
        text = f"✅ GitHub access connected as `{credential['github_login']}`." if credential else "No private GitHub access is connected."
        await interaction.response.send_message(text, ephemeral=True)

    @group.command(name="auth-remove", description="Remove this server's saved GitHub access.")
    async def auth_remove(interaction: discord.Interaction):
        if not is_admin(interaction):
            return await interaction.response.send_message("You need Manage Server permission.", ephemeral=True)
        removed = repo_db.delete_github_credential(interaction.guild_id)
        await interaction.response.send_message("GitHub access removed." if removed else "No GitHub access was saved.", ephemeral=True)
