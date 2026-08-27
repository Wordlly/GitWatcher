import {
  pendingReassignments,
  reassignDeclinedTicket,
  setTicketMessage,
  ticketById,
} from './services/store.js';
import { ticketMessage, ticketCode } from './ui/tickets.js';

export async function handleMessage(message) {
  try {
    if (!message.guildId || !message.guild || message.author.bot) return;

    const pending = await pendingReassignments(
      message.guildId,
      message.channelId,
      message.author.id,
    );

    if (!pending.length) return;

    const mentioned = message.mentions.users.find(
      (user) => !user.bot,
    );
    if (!mentioned) return;

    // A delegator's next valid user mention in the same channel selects the
    // replacement for their oldest declined ticket. Messages from anyone else
    // are ignored because pendingReassignments is scoped to message.author.id.
    const waiting = pending[0];

    const result = await reassignDeclinedTicket(
      waiting.ticket_id,
      message.guildId,
      message.author.id,
      mentioned.id,
    );

    if (!result.ok) {
      await message.reply(result.message);
      return;
    }

    const ticket = await ticketById(waiting.ticket_id);
    if (!ticket || ticket.guild_id !== message.guildId) return;

    const payload = await ticketMessage(ticket);
    const prompt = await message.channel.send({
      content:
        `<@${mentioned.id}> you have been assigned ${ticketCode(ticket)}. ` +
        'Please accept or decline the task.',
      ...payload,
    });

    await setTicketMessage(ticket.id, prompt.id);
  } catch (error) {
    console.error('Message reassignment handler failed:', error);
  }
}
