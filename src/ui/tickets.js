import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';

import {
  ticketAssignees,
  ticketById,
} from '../services/store.js';

export function ticketCode(ticket) {
  return `GW-${String(ticket.ticket_number).padStart(4, '0')}`;
}

export async function ticketMessage(ticket) {
  const assignees = await ticketAssignees(ticket.id);
  const accepted = assignees.filter((x) => x.accepted);
  const signed = assignees.filter((x) => x.signed_off);

  const statusText = {
    OPEN: '🟨 Awaiting acceptance',
    IN_PROGRESS: '🟨 In progress',
    COMPLETED: '🟩 Task has been completed',
    CLOSED: '✅ Ticket has been closed',
  }[ticket.status] || ticket.status;

  const embed = new EmbedBuilder()
    .setTitle(`🎫 ${ticketCode(ticket)} — ${ticket.title}`)
    .addFields({ name: 'Status', value: statusText })
    .setFooter({ text: 'GitWatcher • watches main' });

  if (ticket.ffa) {
    embed.addFields({
      name: 'Free assignment',
      value: `${accepted.length} / ${ticket.max_assignees} accepted`,
    });
  }

  if (assignees.length) {
    embed.addFields({
      name: 'Assigned',
      value: assignees.map((x) => `<@${x.discord_user_id}>`).join(' '),
    });
  }

  if (accepted.length) {
    embed.addFields({
      name: 'Accepted by',
      value: accepted.map((x) => `<@${x.discord_user_id}>`).join(' '),
    });
  }

  if (ticket.commit_sha) {
    embed.addFields({
      name: 'Commit',
      value: `\`${ticket.commit_sha.slice(0, 12)}\``,
    });
  }

  if (ticket.status === 'CLOSED') {
    const complete = signed.length ? signed : accepted;
    embed.setDescription(
      `*${ticket.title}*\nCompleted by ${complete
        .map((x) => `<@${x.discord_user_id}>`)
        .join(' ')}`,
    );
  }

  const accept = new ButtonBuilder()
    .setCustomId(`gw:accept:${ticket.id}`)
    .setLabel('Accept Ticket')
    .setEmoji('✅')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(!['OPEN', 'IN_PROGRESS'].includes(ticket.status));

  const signoff = new ButtonBuilder()
    .setCustomId(`gw:signoff:${ticket.id}`)
    .setLabel('Sign Off')
    .setEmoji('✔️')
    .setStyle(ButtonStyle.Success)
    .setDisabled(ticket.status !== 'COMPLETED');

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(accept, signoff),
    ],
  };
}

export async function refreshTicket(client, ticketId) {
  const ticket = await ticketById(ticketId);
  if (!ticket?.message_id) return;

  try {
    const channel = await client.channels.fetch(ticket.channel_id);
    const message = await channel.messages.fetch(ticket.message_id);
    await message.edit(await ticketMessage(ticket));
  } catch {
    // The original message may have been deleted. Ticket data remains safe.
  }
}
