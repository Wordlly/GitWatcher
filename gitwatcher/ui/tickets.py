import discord
from ..database import tickets as ticket_db

def code(ticket):
    return f"GW-{ticket['ticket_number']:04d}"

def build_embed(ticket):
    assignees = ticket_db.ticket_assignees(ticket["id"])
    accepted = [a for a in assignees if a["accepted"]]
    signed = [a for a in assignees if a["signed_off"]]
    status = ticket["status"]
    if status == "OPEN":
        colour, label = discord.Colour.gold(), "🟨 Awaiting acceptance"
    elif status == "IN_PROGRESS":
        colour, label = discord.Colour.gold(), "🟨 In progress"
    elif status == "COMPLETED":
        colour, label = discord.Colour.green(), "🟩 Task has been completed"
    elif status == "CLOSED":
        colour, label = discord.Colour.green(), "✅ Ticket has been closed"
    else:
        colour, label = discord.Colour.light_grey(), status
    embed = discord.Embed(title=f"🎫 {code(ticket)} — {ticket['title']}", colour=colour)
    embed.add_field(name="Status", value=label, inline=False)
    if ticket["ffa"]:
        embed.add_field(name="Free assignment", value=f"{len(accepted)} / {ticket['max_assignees']} accepted", inline=False)
    if assignees:
        embed.add_field(name="Assigned", value=" ".join(f"<@{a['discord_user_id']}>" for a in assignees), inline=False)
    if accepted:
        embed.add_field(name="Accepted by", value=" ".join(f"<@{a['discord_user_id']}>" for a in accepted), inline=False)
    if ticket["commit_sha"]:
        embed.add_field(name="Commit", value=f"`{ticket['commit_sha'][:12]}`", inline=False)
    if status == "CLOSED":
        completers = signed or accepted
        embed.description = f"*{ticket['title']}*\nCompleted by " + " ".join(f"<@{a['discord_user_id']}>" for a in completers)
    embed.set_footer(text="GitWatcher • watches main")
    return embed

class TicketView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Accept Ticket", emoji="✅", style=discord.ButtonStyle.primary, custom_id="gitwatcher:ticket:accept")
    async def accept(self, interaction, button):
        if not interaction.guild_id or not interaction.message:
            return await interaction.response.send_message("Ticket not found.", ephemeral=True)
        ticket = ticket_db.get_ticket_by_message(interaction.guild_id, interaction.message.id)
        if not ticket:
            return await interaction.response.send_message("Ticket not found.", ephemeral=True)
        ok, msg = ticket_db.accept_ticket(ticket["id"], interaction.user.id)
        if not ok:
            return await interaction.response.send_message(msg, ephemeral=True)
        await interaction.response.defer(ephemeral=True)
        await refresh_ticket_message(interaction.client, ticket["id"])
        await interaction.followup.send(msg, ephemeral=True)

    @discord.ui.button(label="Sign Off", emoji="✔️", style=discord.ButtonStyle.success, custom_id="gitwatcher:ticket:signoff")
    async def signoff(self, interaction, button):
        if not interaction.guild_id or not interaction.message:
            return await interaction.response.send_message("Ticket not found.", ephemeral=True)
        ticket = ticket_db.get_ticket_by_message(interaction.guild_id, interaction.message.id)
        if not ticket:
            return await interaction.response.send_message("Ticket not found.", ephemeral=True)
        ok, msg = ticket_db.sign_off(ticket["id"], interaction.user.id)
        if not ok:
            return await interaction.response.send_message(msg, ephemeral=True)
        await interaction.response.defer(ephemeral=True)
        await refresh_ticket_message(interaction.client, ticket["id"])
        await interaction.followup.send(msg, ephemeral=True)

def view_for_ticket(ticket):
    view = TicketView()
    for item in view.children:
        if isinstance(item, discord.ui.Button):
            if item.custom_id == "gitwatcher:ticket:accept":
                item.disabled = ticket["status"] not in ("OPEN", "IN_PROGRESS")
            elif item.custom_id == "gitwatcher:ticket:signoff":
                item.disabled = ticket["status"] != "COMPLETED"
    return view

async def refresh_ticket_message(client, ticket_id):
    ticket = ticket_db.get_ticket(ticket_id)
    if not ticket or not ticket["message_id"]:
        return
    channel = client.get_channel(ticket["channel_id"])
    if channel is None:
        try:
            channel = await client.fetch_channel(ticket["channel_id"])
        except discord.HTTPException:
            return
    try:
        message = await channel.fetch_message(ticket["message_id"])
        await message.edit(embed=build_embed(ticket), view=view_for_ticket(ticket))
    except discord.HTTPException:
        pass
