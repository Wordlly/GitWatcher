import { config } from '../config.js';
import {
  allActiveRepos,
  discordForGithub,
  markCompleted,
  matchingTickets,
  normalizeTitle,
  setLastSeen,
  allBranchLogs,
  removeBranchLogById,
  setBranchLogLastSeen,
} from './store.js';
import {
  compare,
  mainHead,
  branchHead,
  compareBranchRange,
} from './github.js';
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



async function logCommit(client, subscription, commit) {
  try {
    const channel = await client.channels.fetch(subscription.channel_id);

    const firstLine = (commit.commit?.message || '').split('\n')[0] || 'No commit message';
    const author =
      commit.author?.login ||
      commit.commit?.author?.name ||
      'Unknown author';

    const shortSha = commit.sha.slice(0, 7);
    const url =
      commit.html_url ||
      `https://github.com/${subscription.owner}/${subscription.repo}/commit/${commit.sha}`;

    await channel.send(
      `🔨 **${author}** pushed to \`${subscription.branch}\`\n` +
      `[\`${shortSha}\`](${url}) ${firstLine}`,
    );
  } catch (error) {
    console.error(
      `Could not send branch log ${subscription.id}:`,
      error.message,
    );
  }
}

async function checkBranchLog(client, subscription) {
  const current = await branchHead(
    subscription.guild_id,
    subscription.owner,
    subscription.repo,
    subscription.branch,
  );

  if (!current.exists) {
    await removeBranchLogById(subscription.id);

    try {
      const channel = await client.channels.fetch(subscription.channel_id);
      await channel.send(
        `🗑️ Stopped logging \`${subscription.owner}/${subscription.repo}:${subscription.branch}\` because that branch no longer exists.`,
      );
    } catch {
      // Subscription has already been removed, so there is nothing left to poll.
    }

    return;
  }

  if (!subscription.last_seen_sha) {
    await setBranchLogLastSeen(subscription.id, current.sha);
    return;
  }

  if (subscription.last_seen_sha === current.sha) {
    return;
  }

  try {
    const commits = await compareBranchRange(
      subscription.guild_id,
      subscription.owner,
      subscription.repo,
      subscription.last_seen_sha,
      current.sha,
    );

    for (const commit of commits) {
      await logCommit(client, subscription, commit);
    }
  } catch (error) {
    // A force-push/rewrite can make the old checkpoint incomparable.
    // Reset without replaying uncertain history.
    console.error(
      `Branch log checkpoint reset ${subscription.owner}/${subscription.repo}:${subscription.branch}:`,
      error.message,
    );
  }

  await setBranchLogLastSeen(subscription.id, current.sha);
}

async function runBranchLogs(client) {
  const logs = await allBranchLogs();

  for (const subscription of logs) {
    try {
      await checkBranchLog(client, subscription);
    } catch (error) {
      console.error(
        `Branch log error ${subscription.guild_id}:${subscription.owner}/${subscription.repo}:${subscription.branch}:`,
        error.message,
      );
    }
  }
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

    await runBranchLogs(client);
  };

  run().catch(console.error);

  return setInterval(
    () => run().catch(console.error),
    config.pollSeconds * 1000,
  );
}
