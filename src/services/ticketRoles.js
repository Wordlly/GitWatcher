import {
  clearTicketRoleId,
  setTicketRoleId,
  ticketById,
} from './store.js';

function ticketCode(ticket) {
  return `GW-${String(ticket.ticket_number).padStart(4, '0')}`;
}

export async function assignTicketRole(guild, ticketId, discordUserId) {
  const ticket = await ticketById(ticketId);
  if (!ticket) throw new Error('Ticket not found while assigning its role.');

  let role = null;

  if (ticket.ticket_role_id) {
    role = await guild.roles.fetch(ticket.ticket_role_id).catch(() => null);
  }

  if (!role) {
    role = await guild.roles.create({
      name: ticketCode(ticket),
      permissions: [],
      reason: `GitWatcher ticket ${ticketCode(ticket)} accepted`,
    });

    await setTicketRoleId(ticket.id, role.id);
  }

  const member = await guild.members.fetch(discordUserId);
  await member.roles.add(
    role,
    `Accepted GitWatcher ticket ${ticketCode(ticket)}`,
  );

  return role;
}

export async function deleteTicketRole(guild, ticketId) {
  const ticket = await ticketById(ticketId);
  if (!ticket?.ticket_role_id) return false;

  const role = await guild.roles.fetch(ticket.ticket_role_id).catch(() => null);

  if (role) {
    await role.delete(
      `GitWatcher ticket ${ticketCode(ticket)} finished or transferred`,
    );
  }

  await clearTicketRoleId(ticket.id);
  return true;
}
