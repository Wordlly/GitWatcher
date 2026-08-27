import { adminLogChannel } from './store.js';

export async function sendAdminLog(client, guildId, message) {
  const channelId = await adminLogChannel(guildId);
  if (!channelId) return false;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return false;
    await channel.send(message);
    return true;
  } catch (error) {
    console.error(`Admin log send failed for guild ${guildId}:`, error.message);
    return false;
  }
}
