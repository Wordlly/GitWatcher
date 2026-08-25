import re
import discord
from discord import app_commands
from ..database import repositories as repo_db
from ..database import tickets as ticket_db
from ..ui.tickets import build_embed, view_for_ticket, refresh_ticket_message

def is_admin(interaction):
    p = interaction.user.guild_permissions
    return p.manage_guild or p.administrator

def parse_ticket_number(value):
    m = re.fullmatch(r"(?:GW-)?0*(\d+)", value.strip(), re.IGNORECASE)
    if not m:
        raise ValueError("Use a ticket like `GW-0003`.")
    return int(m.group(1))

async def repo_or_error(interaction):
    repo = repo_db.get_repository_for_channel(interaction.guild_id, interaction.channel_id)
    if repo:
        return repo
    await interaction.response.send_message("This channel is not watching a GitHub repo yet. Use `/gitwatcher watch` first.", ephemeral=True)
    return None

def register(group: app_commands.Group):
    @group.command(name="assign", description="Assign a development task to one person.")
    @app_commands.describe(user="Person doing the task", description="Task / commit description")
    async def assign(interaction: discord.Interaction, user: discord.Member, description: str):
        if not is_admin(interaction):
            return await interaction.response.send_message("You need Manage Server permission.", ephemeral=True)
        repo = await repo_or_error(interaction)
        if not repo:
            return
        if not description.strip():
            return await interaction.response.send_message("Give the ticket a description.", ephemeral=True)
        ticket = ticket_db.create_ticket(
            interaction.guild_id, repo["id"], interaction.channel_id, description,
            interaction.user.id, [user.id], 1, False,
        )
        await interaction.response.send_message(embed=build_embed(ticket), view=view_for_ticket(ticket))
        message = await interaction.original_response()
        ticket_db.set_message_id(ticket["id"], message.id)

    @group.command(name="ffa", description="Create a task anyone can accept.")
    @app_commands.describe(description="Task / commit description", slots="How many people can accept it")
    async def ffa(interaction: discord.Interaction, description: str, slots: app_commands.Range[int,1,10]):
        if not is_admin(interaction):
            return await interaction.response.send_message("You need Manage Server permission.", ephemeral=True)
        repo = await repo_or_error(interaction)
        if not repo:
            return
        ticket = ticket_db.create_ticket(
            interaction.guild_id, repo["id"], interaction.channel_id, description,
            interaction.user.id, [], slots, True,
        )
        await interaction.response.send_message(embed=build_embed(ticket), view=view_for_ticket(ticket))
        message = await interaction.original_response()
        ticket_db.set_message_id(ticket["id"], message.id)

    @group.command(name="transfer", description="Hand a manual ticket to someone else.")
    @app_commands.describe(ticket="Example: GW-0003", user="New assignee")
    async def transfer(interaction: discord.Interaction, ticket: str, user: discord.Member):
        if not is_admin(interaction):
            return await interaction.response.send_message("You need Manage Server permission.", ephemeral=True)
        try:
            number = parse_ticket_number(ticket)
        except ValueError as exc:
            return await interaction.response.send_message(str(exc), ephemeral=True)
        ok, msg, existing = ticket_db.transfer_ticket(interaction.guild_id, number, user.id)
        if not ok:
            return await interaction.response.send_message(msg, ephemeral=True)
        await refresh_ticket_message(interaction.client, existing["id"])
        await interaction.response.send_message(f"GW-{number:04d} transferred to {user.mention}.", ephemeral=True)
