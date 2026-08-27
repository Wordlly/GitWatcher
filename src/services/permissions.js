import { PermissionFlagsBits } from 'discord.js';
import { micromanagerRole } from './store.js';

export function isServerAdmin(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.Administrator),
  );
}

export function canManageServer(interaction) {
  return Boolean(
    interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ||
    isServerAdmin(interaction),
  );
}

export async function canMicromanage(interaction) {
  // Preserve GitWatcher's existing Manage Server access while also allowing
  // the server's explicitly configured Micromanager role.
  if (canManageServer(interaction)) return true;
  if (!interaction.guild || !interaction.guildId) return false;

  const roleId = await micromanagerRole(interaction.guildId);
  if (!roleId) return false;

  const member = await interaction.guild.members.fetch(interaction.user.id);
  return member.roles.cache.has(roleId);
}
