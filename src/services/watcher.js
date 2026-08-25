import { config } from '../config.js';
import {
  allActiveRepos,
  discordForGithub,
  markCompleted,
  matchingTickets,
  normalizeTitle,
  setLastSeen,
} from './store.js';
import { compare, mainHead } from './github.js';
import { refreshTicket } from '../ui/tickets.js';

async function notify(client, repository, text) {
  try {
    const channel = await client.channels.fetch(repository.channel_id);
    await channel.send(text);
  } catch {
    // Ignore Discord send failures; watcher state remains intact.
  }
}

async function processCommit(client, repository, commit) {
  const firstLine = (commit.commit?.message || '').split('\n')[0];
  const normalized = normalizeTitle(firstLine);
  if (!normalized) return;

  const githubUser = commit.author;
  if (!githubUser?.id) return;

  const discordUserId = await discordForGithub(
    repository.guild_id,
    githubUser.id,
  );
  if (!discordUserId) return;

  const matches = await matchingTickets(
    repository.id,
    normalized,
    discordUserId,
  );

  if (matches.length === 0) return;

  if (matches.length > 1) {
    await notify(
      client,
      repository,
      `⚠️ More than one active ticket named \`${firstLine}\` matches <@${discordUserId}>. I left them unchanged.`,
    );
    return;
  }

  await markCompleted(matches[0].id, commit, githubUser);
  await refreshTicket(client, matches[0].id);
}

async function checkRepo(client, repository) {
  const head = await mainHead(repository);

  if (!repository.last_seen_sha) {
    await setLastSeen(repository.id, head);
    return;
  }

  if (head === repository.last_seen_sha) return;

  try {
    const commits = await compare(
      repository,
      repository.last_seen_sha,
      head,
    );

    for (const commit of commits) {
      await processCommit(client, repository, commit);
    }
  } catch (error) {
    await notify(
      client,
      repository,
      `⚠️ GitWatcher could not compare the previous main checkpoint for \`${repository.owner}/${repository.repo}\`. It reset the checkpoint without completing any tickets.`,
    );
  }

  await setLastSeen(repository.id, head);
}

export function startWatcher(client) {
  const run = async () => {
    const repos = await allActiveRepos();

    for (const repository of repos) {
      try {
        await checkRepo(client, repository);
      } catch (error) {
        console.error(
          `Watcher error ${repository.guild_id}:${repository.owner}/${repository.repo}:`,
          error.message,
        );
      }
    }
  };

  run().catch(console.error);

  return setInterval(
    () => run().catch(console.error),
    config.pollSeconds * 1000,
  );
}
