import express from 'express';
import {
  Client,
  GatewayIntentBits,
} from 'discord.js';

import { config } from './config.js';
import { migrate } from './db/schema.js';
import { gitwatcherCommand } from './commands/definition.js';
import { handleInteraction } from './interactions.js';
import { startWatcher } from './services/watcher.js';

const app = express();

app.get('/', (_req, res) => {
  res.json({ name: 'GitWatcher', status: 'ok' });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Health server listening on ${config.port}`);
});

await migrate();
console.log('PostgreSQL ready.');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});

client.on('interactionCreate', handleInteraction);

client.once('ready', async () => {
  console.log(`Discord connected as ${client.user.tag}`);

  // Global command registration: one unchanged bot works in every server.
  await client.application.commands.set([gitwatcherCommand]);
  console.log('Global /gitwatcher command registered.');

  startWatcher(client);
  console.log('GitHub watcher started.');
});

await client.login(config.discordToken);
