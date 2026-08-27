import {
  acceptTicket,
  declineTicket,
  manualCloseTicket,
  signOffTicket,
  ticketById,
} from './services/store.js';
import { refreshTicket, ticketCode } from './ui/tickets.js';
import {
  assignTicketRole,
  deleteTicketRole,
  memberHasTicketRole,
} from './services/ticketRoles.js';
import { sendAdminLog } from './services/adminLog.js';
import {
  handleAuthModal,
  handleCommand,
} from './commands/handler.js';

async function requireTicketRole(interaction, ticketId) {
  const hasRole = await memberHasTicketRole(
    interaction.guild,
    ticketId,
    interaction.user.id,
  );

  if (hasRole) return true;

  await interaction.reply({
    content: 'You do not have the Discord role for this ticket.',
    ephemeral: true,
  });
  return false;
}

export async function handleInteraction(interaction) {
  try {
    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === 'gitwatcher'
    ) {
      return await handleCommand(interaction);
    }

    if (
      interaction.isModalSubmit() &&
      interaction.customId === 'gw:auth-modal'
    ) {
      return await handleAuthModal(interaction);
    }

    if (interaction.isButton()) {
      const [prefix, action, ticketIdText] = interaction.customId.split(':');

      if (prefix !== 'gw') return;

      const ticketId = Number(ticketIdText);
      if (!ticketId || !interaction.guildId || !interaction.guild) return;

      const ticket = await ticketById(ticketId);
      if (!ticket || ticket.guild_id !== interaction.guildId) {
        return interaction.reply({
          content: 'This ticket does not belong to this server.',
          ephemeral: true,
        });
      }

      if (action === 'accept') {
        const result = await acceptTicket(
          ticketId,
          interaction.guildId,
          interaction.user.id,
        );

        if (!result.ok) {
          return interaction.reply({
            content: result.message,
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });

        let roleWarning = '';

        try {
          await assignTicketRole(
            interaction.guild,
            ticketId,
            interaction.user.id,
          );
        } catch (error) {
          console.error('Ticket role assignment failed:', error);
          roleWarning =
            '\n⚠️ Ticket accepted, but I could not assign the Discord role. ' +
            'Make sure GitWatcher has **Manage Roles** and its bot role is above ticket roles.';
        }

        await refreshTicket(interaction.client, ticketId);
        return interaction.editReply(result.message + roleWarning);
      }

      if (action === 'decline') {
        const result = await declineTicket(
          ticketId,
          interaction.guildId,
          interaction.user.id,
        );

        if (!result.ok) {
          return interaction.reply({
            content: result.message,
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });
        await refreshTicket(interaction.client, ticketId);

        await interaction.channel.send(
          `<@${interaction.user.id}> has declined the task <@${result.ticket.created_by}>, ` +
          'please select a new member to take on this task.',
        );

        await sendAdminLog(
          interaction.client,
          interaction.guildId,
          `<@${interaction.user.id}> rejected task ${ticketCode(result.ticket)} "${result.ticket.title}"`,
        );

        return interaction.editReply('Task declined.');
      }

      if (action === 'signoff') {
        if (!(await requireTicketRole(interaction, ticketId))) return;

        const result = await signOffTicket(
          ticketId,
          interaction.guildId,
          interaction.user.id,
        );

        if (!result.ok) {
          return interaction.reply({
            content: result.message,
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });

        let roleWarning = '';
        const updated = await ticketById(ticketId);

        if (updated?.status === 'CLOSED') {
          try {
            await deleteTicketRole(interaction.guild, ticketId);
          } catch (error) {
            console.error('Ticket role cleanup failed:', error);
            roleWarning =
              '\n⚠️ Ticket closed, but I could not remove its Discord role.';
          }
        }

        await refreshTicket(interaction.client, ticketId);
        return interaction.editReply(result.message + roleWarning);
      }

      if (action === 'manualclose') {
        if (!(await requireTicketRole(interaction, ticketId))) return;

        const result = await manualCloseTicket(
          ticketId,
          interaction.guildId,
          interaction.user.id,
        );

        if (!result.ok) {
          return interaction.reply({
            content: result.message,
            ephemeral: true,
          });
        }

        await interaction.deferReply({ ephemeral: true });
        await refreshTicket(interaction.client, ticketId);

        let roleWarning = '';
        try {
          await deleteTicketRole(interaction.guild, ticketId);
        } catch (error) {
          console.error('Ticket role cleanup failed after manual close:', error);
          roleWarning = '\n⚠️ I could not remove the ticket role.';
        }

        await sendAdminLog(
          interaction.client,
          interaction.guildId,
          `<@${interaction.user.id}> Manually completed task ${ticketCode(result.ticket)} "${result.ticket.title}"`,
        );

        return interaction.editReply(
          'Ticket manually closed.' + roleWarning,
        );
      }
    }
  } catch (error) {
    console.error('Interaction error:', error);

    const message =
      error.response?.data?.message ||
      error.message ||
      'Something went wrong.';

    if (interaction.deferred || interaction.replied) {
      return interaction
        .editReply({ content: `❌ ${message}` })
        .catch(() => {});
    }

    return interaction
      .reply({ content: `❌ ${message}`, ephemeral: true })
      .catch(() => {});
  }
}
