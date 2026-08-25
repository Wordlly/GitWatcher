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
import { handleGithubWebhook } from './services/webhook.js';

await migrate();
console.log('PostgreSQL ready.');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
  ],
});

const app = express();

app.get('/', (_req, res) => {
  res.json({ name: 'GitWatcher', status: 'ok' });
});

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// GitHub signatures must be checked against the untouched request bytes.
app.post(
  '/github/webhook/:id',
  express.raw({ type: 'application/json', limit: '2mb' }),
  async (req, res) => {
    try {
      await handleGithubWebhook(req, res, client);
    } catch (error) {
      console.error('GitHub webhook error:', error);
      if (!res.headersSent) res.status(500).send('Webhook error');
    }
  },
);

app.listen(config.port, '0.0.0.0', () => {
  console.log(`Health/webhook server listening on ${config.port}`);
});

client.on('interactionCreate', handleInteraction);

client.once('ready', async () => {
  console.log(`Discord connected as ${client.user.tag}`);

  console.log(
    'Registering /gitwatcher subcommands:',
    gitwatcherCommand.options.map((option) => option.name),
  );

  const commands = await client.application.commands.set([
    gitwatcherCommand,
  ]);

  console.log(
    'Registered Discord commands:',
    commands.map((command) => ({
      name: command.name,
      id: command.id,
      options: command.options.map((option) => option.name),
    })),
  );

  startWatcher(client);
  console.log('GitHub watcher started.');
});

await client.login(config.discordToken);
