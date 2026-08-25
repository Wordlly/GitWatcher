import {
  acceptTicket,
  signOffTicket,
  ticketById,
} from './services/store.js';
import { refreshTicket } from './ui/tickets.js';
import {
  assignTicketRole,
  deleteTicketRole,
} from './services/ticketRoles.js';
import {
  handleAuthModal,
  handleCommand,
} from './commands/handler.js';

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
      if (!ticketId) return;

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

      if (action === 'signoff') {
        const result = await signOffTicket(
          ticketId,
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
        const ticket = await ticketById(ticketId);

        if (ticket?.status === 'CLOSED') {
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
