import discord
from discord import app_commands
from ..database import repositories as repo_db

def register(group: app_commands.Group):
    @group.command(name="status", description="Show GitWatcher's setup for this server.")
    async def status(interaction: discord.Interaction):
        repos = repo_db.list_repositories(interaction.guild_id)
        credential = repo_db.get_github_credential(interaction.guild_id)
        access = f"`{credential['github_login']}`" if credential else "public repos only"
        await interaction.response.send_message(f"✅ GitWatcher is online.\nGitHub access: {access}\nWatched repos: {len(repos)}", ephemeral=True)

    @group.command(name="help", description="Show the GitWatcher help menu.")
    async def help_command(interaction: discord.Interaction):
        embed = discord.Embed(title="GitWatcher Help", description="Everything is controlled from Discord.", colour=discord.Colour.blurple())
        embed.add_field(name="1. Link yourself", value="`/gitwatcher setuser Wordlly`\nor\n`/gitwatcher setuser https://github.com/Wordlly`", inline=False)
        embed.add_field(name="2. Private repo?", value="Admin runs `/gitwatcher auth` and pastes a GitHub token.\nPublic repos can skip this.", inline=False)
        embed.add_field(name="3. Watch a repo", value="In the Discord channel for that repo:\n`/gitwatcher watch https://github.com/owner/repo`", inline=False)
        embed.add_field(name="4. Create work", value="`/gitwatcher assign @user \"Setup development notes\"`\n`/gitwatcher ffa \"Create Django repo\" 2`", inline=False)
        embed.add_field(name="5. Commit normally", value="Ticket: `Setup development notes`\nCommit: `setup development notes` ✅\nCapitalisation and repeated spaces do not matter.", inline=False)
        embed.add_field(name="More", value="`/gitwatcher repos`\n`/gitwatcher unwatch`\n`/gitwatcher whoami`\n`/gitwatcher transfer GW-0003 @user`\n`/gitwatcher status`\n`/gitwatcher auth-status`\n`/gitwatcher auth-remove`", inline=False)
        await interaction.response.send_message(embed=embed, ephemeral=True)
