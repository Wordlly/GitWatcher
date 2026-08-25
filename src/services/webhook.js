import crypto from 'crypto';

import { decryptSecret } from './crypto.js';
import {
  discordForGithubLogin,
  getWebhookEndpoint,
  markCompleted,
  matchingTickets,
  normalizeTitle,
} from './store.js';
import { refreshTicket } from '../ui/tickets.js';

function validSignature(rawBody, secret, signature) {
  if (!signature?.startsWith('sha256=')) return false;

  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')}`;

  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function processPush(client, endpoint, payload) {
  if (payload.ref !== 'refs/heads/main' || payload.deleted) return;

  for (const commit of payload.commits || []) {
    const firstLine = (commit.message || '').split('\n')[0];
    const normalized = normalizeTitle(firstLine);
    const login = commit.author?.username;

    if (!normalized || !login) continue;

    const discordUserId = await discordForGithubLogin(
      endpoint.guild_id,
      login,
    );
    if (!discordUserId) continue;

    const matches = await matchingTickets(
      endpoint.repository_id,
      normalized,
      discordUserId,
    );

    if (matches.length === 0) continue;

    if (matches.length > 1) {
      try {
        const channel = await client.channels.fetch(endpoint.channel_id);
        await channel.send(
          `⚠️ More than one active ticket named \`${firstLine}\` matches <@${discordUserId}>. I left them unchanged.`,
        );
      } catch {}
      continue;
    }

    await markCompleted(
      matches[0].id,
      { sha: commit.id },
      { id: null, login },
    );
    await refreshTicket(client, matches[0].id);
  }
}

export async function handleGithubWebhook(req, res, client) {
  const endpoint = await getWebhookEndpoint(req.params.id);
  if (!endpoint) return res.status(404).send('Unknown webhook');

  const secret = decryptSecret(endpoint.secret_encrypted);
  const rawBody = req.body;
  const signature = req.get('X-Hub-Signature-256');

  if (!Buffer.isBuffer(rawBody) || !validSignature(rawBody, secret, signature)) {
    return res.status(401).send('Invalid signature');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).send('Invalid JSON');
  }

  const fullName = payload.repository?.full_name?.toLowerCase();
  const expected = `${endpoint.owner}/${endpoint.repo}`.toLowerCase();
  if (fullName && fullName !== expected) {
    return res.status(403).send('Repository mismatch');
  }

  const event = req.get('X-GitHub-Event');

  if (event === 'ping') {
    return res.status(200).send('GitWatcher webhook ready');
  }

  if (event === 'push') {
    await processPush(client, endpoint, payload);
  }

  return res.status(200).send('OK');
}
