\
import discord

from . import db


class TicketView(discord.ui.View):
    """One persistent view can serve every ticket because message_id identifies the ticket."""

    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(
        label="Accept Ticket",
        style=discord.ButtonStyle.primary,
        emoji="✅",
        custom_id="gitwatcher:accept",
    )
    async def accept(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not interaction.message:
            return await interaction.response.send_message("Ticket message not found.", ephemeral=True)

        ticket = db.get_ticket_by_message(interaction.message.id)
        if not ticket:
            return await interaction.response.send_message("Ticket not found.", ephemeral=True)

        ok, msg = db.accept_ticket(ticket["id"], interaction.user.id)
        if not ok:
            return await interaction.response.send_message(msg, ephemeral=True)

        await interaction.response.defer(ephemeral=True)
        await refresh_ticket_message(interaction.client, ticket["id"])
        await interaction.followup.send("Ticket accepted.", ephemeral=True)

    @discord.ui.button(
        label="Sign Off",
        style=discord.ButtonStyle.success,
        emoji="✔️",
        custom_id="gitwatcher:signoff",
    )
    async def signoff(self, interaction: discord.Interaction, button: discord.ui.Button):
        if not interaction.message:
            return await interaction.response.send_message("Ticket message not found.", ephemeral=True)

        ticket = db.get_ticket_by_message(interaction.message.id)
        if not ticket:
            return await interaction.response.send_message("Ticket not found.", ephemeral=True)

        ok, msg = db.sign_off(ticket["id"], interaction.user.id)
        if not ok:
            return await interaction.response.send_message(msg, ephemeral=True)

        await interaction.response.defer(ephemeral=True)
        await refresh_ticket_message(interaction.client, ticket["id"])
        await interaction.followup.send("Signed off.", ephemeral=True)


def ticket_embed(ticket: dict) -> discord.Embed:
    assignees = db.ticket_assignees(ticket["id"])
    accepted = [a for a in assignees if a["accepted"]]
    signed = [a for a in assignees if a["signed_off"]]

    if ticket["status"] == "OPEN":
        colour = discord.Colour.gold()
        state = "🟨 Awaiting acceptance"
    elif ticket["status"] == "IN_PROGRESS":
        colour = discord.Colour.gold()
        state = "🟨 IN PROGRESS"
    elif ticket["status"] == "COMPLETED":
        colour = discord.Colour.green()
        state = "🟩 Task has been completed"
    elif ticket["status"] == "CLOSED":
        colour = discord.Colour.green()
        state = "✅ Ticket has been closed"
    else:
        colour = discord.Colour.light_grey()
        state = ticket["status"]

    embed = discord.Embed(
        title=f"🎫 {ticket['code']} — {ticket['title']}",
        colour=colour,
    )
    embed.add_field(name="Status", value=state, inline=False)

    if ticket["ffa"]:
        embed.add_field(
            name="Free assignment",
            value=f"{len(accepted)} / {ticket['max_assignees']} accepted",
            inline=False,
        )

    if assignees:
        assigned_mentions = " ".join(f"<@{a['discord_user_id']}>" for a in assignees)
        embed.add_field(name="Assigned", value=assigned_mentions, inline=False)

    if accepted:
        accepted_mentions = " ".join(f"<@{a['discord_user_id']}>" for a in accepted)
        embed.add_field(name="Accepted by", value=accepted_mentions, inline=False)

    if ticket["commit_sha"]:
        embed.add_field(
            name="Completion commit",
            value=f"`{ticket['commit_sha'][:12]}`",
            inline=False,
        )

    if ticket["status"] == "CLOSED":
        completers = signed or accepted
        mentions = " ".join(f"<@{a['discord_user_id']}>" for a in completers)
        embed.description = f"*{ticket['title']}*\nCompleted by {mentions}"

    embed.set_footer(text="GitWatcher • main branch only")
    return embed


def ticket_view(ticket: dict) -> TicketView:
    view = TicketView()
    # Disable buttons based on state while preserving persistent custom IDs.
    for item in view.children:
        if isinstance(item, discord.ui.Button):
            if item.custom_id == "gitwatcher:accept":
                item.disabled = ticket["status"] not in ("OPEN", "IN_PROGRESS")
            elif item.custom_id == "gitwatcher:signoff":
                item.disabled = ticket["status"] != "COMPLETED"
    return view


async def refresh_ticket_message(client: discord.Client, ticket_id: int):
    ticket = db.get_ticket(ticket_id)
    if not ticket or not ticket.get("message_id"):
        return

    channel = client.get_channel(ticket["channel_id"])
    if channel is None:
        try:
            channel = await client.fetch_channel(ticket["channel_id"])
        except discord.HTTPException:
            return

    try:
        message = await channel.fetch_message(ticket["message_id"])
        await message.edit(embed=ticket_embed(ticket), view=ticket_view(ticket))
    except discord.HTTPException:
        pass
