import {
  EmbedBuilder,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} from 'discord.js';

import { encryptSecret } from '../services/crypto.js';
import {
  authenticatedUser,
  getUser,
  guildToken,
  parseProfile,
  parseRepo,
  validateRepo,
  branchHead,
} from '../services/github.js';
import {
  credentialStatus,
  createTicket,
  repoForChannel,
  reposForGuild,
  removeCredential,
  saveCredential,
  setTicketMessage,
  setUser,
  transferTicket,
  unwatchChannel,
  watchRepo,
  whoami,
  addBranchLog,
  removeBranchLog,
  branchLogsForGuild,
} from '../services/store.js';
import { ticketMessage } from '../ui/tickets.js';
import { refreshTicket } from '../ui/tickets.js';

function admin(interaction) {
  return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
}

function parseTicketNumber(value) {
  const match = value.trim().match(/^(?:GW-)?0*(\d+)$/i);
  if (!match) throw new Error('Use a ticket like GW-0003.');
  return Number(match[1]);
}

async function help(interaction) {
  const embed = new EmbedBuilder()
    .setTitle('GitWatcher Help')
    .setDescription('Everything is controlled from Discord.')
    .addFields(
      {
        name: '1. Link yourself',
        value:
          '`/gitwatcher setuser {github username (case sensitive)}`\n' +
          'or\n' +
          '`/gitwatcher setuser {github profile url}`',
      },
      {
        name: '2. Private repo?',
        value: 'Admin runs `/gitwatcher auth` and pastes a GitHub token.',
      },
      {
        name: '3. Watch a repo',
        value:
          'In the repo’s Discord channel:\n' +
          '`/gitwatcher watch {Github repo main url}`',
      },
      {
        name: '4. Create work',
        value:
          '`/gitwatcher assign {@user} {commit description}`\n' +
          '`/gitwatcher ffa {commit description} {number of users}`',
      },
      {
        name: '5. Commit normally',
        value:
          'Ticket: `Setup development notes`\n' +
          'Commit: `setup development notes` ✅\n' +
          'Capitalisation and repeated spaces do not matter.',
      },
      {
        name: 'Optional: branch logs',
        value:
          '`/gitwatcher logs repository:<url> branch:main`\n' +
          '`/gitwatcher unlog repository:<url> branch:main`\n' +
          '`/gitwatcher log-list`',
      },
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export async function handleCommand(interaction) {
  const sub = interaction.options.getSubcommand();

  if (sub === 'help') return help(interaction);

  if (sub === 'status') {
    const repos = await reposForGuild(interaction.guildId);
    const credential = await credentialStatus(interaction.guildId);

    return interaction.reply({
      content:
        `✅ GitWatcher is online.\n` +
        `GitHub access: ${credential ? `\`${credential.github_login}\`` : 'public repos only'}\n` +
        `Watched repos: ${repos.length}`,
      ephemeral: true,
    });
  }

  if (sub === 'auth') {
    if (!admin(interaction)) {
      return interaction.reply({
        content: 'You need Manage Server permission.',
        ephemeral: true,
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('gw:auth-modal')
      .setTitle('Connect GitHub');

    const token = new TextInputBuilder()
      .setCustomId('token')
      .setLabel('GitHub token')
      .setPlaceholder('Paste your GitHub token')
      .setStyle(TextInputStyle.Short)
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder().addComponents(token),
    );

    return interaction.showModal(modal);
  }

  if (sub === 'auth-status') {
    const credential = await credentialStatus(interaction.guildId);
    return interaction.reply({
      content: credential
        ? `✅ GitHub access connected as \`${credential.github_login}\`.`
        : 'No private GitHub access is connected.',
      ephemeral: true,
    });
  }

  if (sub === 'auth-remove') {
    if (!admin(interaction)) {
      return interaction.reply({
        content: 'You need Manage Server permission.',
        ephemeral: true,
      });
    }

    const removed = await removeCredential(interaction.guildId);
    return interaction.reply({
      content: removed ? 'GitHub access removed.' : 'No GitHub access was saved.',
      ephemeral: true,
    });
  }

  if (sub === 'setuser') {
    await interaction.deferReply({ ephemeral: true });

    const input = interaction.options.getString('github', true);
    const username = parseProfile(input);
    const token = await guildToken(interaction.guildId);
    const githubUser = await getUser(username, token);

    const result = await setUser(
      interaction.guildId,
      interaction.user.id,
      githubUser,
    );

    if (!result.ok) {
      return interaction.editReply(
        `❌ GitHub \`${githubUser.login}\` is already linked to <@${result.discordUserId}> in this server.`,
      );
    }

    return interaction.editReply(
      `✅ You are linked to GitHub \`${githubUser.login}\`.`,
    );
  }

  if (sub === 'whoami') {
    const linked = await whoami(interaction.guildId, interaction.user.id);
    return interaction.reply({
      content: linked
        ? `You are linked to GitHub \`${linked.github_login}\`.`
        : 'You have not linked GitHub yet. Use `/gitwatcher setuser`.',
      ephemeral: true,
    });
  }

  if (sub === 'watch') {
    if (!admin(interaction)) {
      return interaction.reply({
        content: 'You need Manage Server permission.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    const input = interaction.options.getString('repository', true);
    const parsed = parseRepo(input);
    const checked = await validateRepo(
      interaction.guildId,
      parsed.owner,
      parsed.repo,
    );

    const saved = await watchRepo(
      interaction.guildId,
      interaction.channelId,
      checked,
      interaction.user.id,
    );

    return interaction.editReply(
      `👀 Watching \`${saved.owner}/${saved.repo}\` → \`main\` ` +
      `(${saved.is_private ? 'private' : 'public'}) in this channel.`,
    );
  }

  if (sub === 'unwatch') {
    if (!admin(interaction)) {
      return interaction.reply({
        content: 'You need Manage Server permission.',
        ephemeral: true,
      });
    }

    const removed = await unwatchChannel(
      interaction.guildId,
      interaction.channelId,
    );

    return interaction.reply({
      content: removed
        ? 'Stopped watching this channel’s repository.'
        : 'This channel is not watching a repository.',
      ephemeral: true,
    });
  }

  if (sub === 'repos') {
    const repos = await reposForGuild(interaction.guildId);

    return interaction.reply({
      content: repos.length
        ? repos
            .map(
              (repo) =>
                `• <#${repo.channel_id}> → \`${repo.owner}/${repo.repo}\` (\`main\`)`,
            )
            .join('\n')
        : 'This server is not watching any repositories yet.',
      ephemeral: true,
    });
  }


  if (sub === 'logs') {
    if (!admin(interaction)) {
      return interaction.reply({
        content: 'You need Manage Server permission.',
        ephemeral: true,
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const repositoryUrl = interaction.options.getString('repository', true);
    const branch = interaction.options.getString('branch', true).trim();

    if (!branch) {
      return interaction.editReply('Give me a branch name.');
    }

    const parsed = parseRepo(repositoryUrl);
    const checked = await branchHead(
      interaction.guildId,
      parsed.owner,
      parsed.repo,
      branch,
    );

    if (!checked.exists) {
      return interaction.editReply(
        `❌ I cannot find branch \`${branch}\` in \`${parsed.owner}/${parsed.repo}\`.`,
      );
    }

    await addBranchLog({
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      owner: parsed.owner,
      repo: parsed.repo,
      branch: checked.branch,
      lastSeenSha: checked.sha,
      createdBy: interaction.user.id,
    });

    return interaction.editReply(
      `📝 Logging new commits from \`${parsed.owner}/${parsed.repo}:${checked.branch}\` in this channel.`,
    );
  }

  if (sub === 'unlog') {
    if (!admin(interaction)) {
      return interaction.reply({
        content: 'You need Manage Server permission.',
        ephemeral: true,
      });
    }

    const repositoryUrl = interaction.options.getString('repository', true);
    const branch = interaction.options.getString('branch', true).trim();
    const parsed = parseRepo(repositoryUrl);

    const removed = await removeBranchLog(
      interaction.guildId,
      interaction.channelId,
      parsed.owner,
      parsed.repo,
      branch,
    );

    return interaction.reply({
      content: removed
        ? `Stopped logging \`${parsed.owner}/${parsed.repo}:${branch}\` in this channel.`
        : 'That branch is not being logged in this channel.',
      ephemeral: true,
    });
  }

  if (sub === 'log-list') {
    const logs = await branchLogsForGuild(interaction.guildId);

    return interaction.reply({
      content: logs.length
        ? logs
            .map(
              (log) =>
                `• <#${log.channel_id}> → \`${log.owner}/${log.repo}:${log.branch}\``,
            )
            .join('\n')
        : 'This server has no branch logs configured.',
      ephemeral: true,
    });
  }

  if (sub === 'assign' || sub === 'ffa') {
    if (!admin(interaction)) {
      return interaction.reply({
        content: 'You need Manage Server permission.',
        ephemeral: true,
      });
    }

    const repository = await repoForChannel(
      interaction.guildId,
      interaction.channelId,
    );

    if (!repository) {
      return interaction.reply({
        content:
          'This channel is not watching a GitHub repo yet. Use `/gitwatcher watch` first.',
        ephemeral: true,
      });
    }

    const description = interaction.options.getString('description', true);

    const ticket =
      sub === 'assign'
        ? await createTicket({
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            repositoryId: repository.id,
            title: description,
            createdBy: interaction.user.id,
            assignees: [interaction.options.getUser('user', true).id],
            maxAssignees: 1,
            ffa: false,
          })
        : await createTicket({
            guildId: interaction.guildId,
            channelId: interaction.channelId,
            repositoryId: repository.id,
            title: description,
            createdBy: interaction.user.id,
            assignees: [],
            maxAssignees: interaction.options.getInteger('slots', true),
            ffa: true,
          });

    await interaction.reply(await ticketMessage(ticket));
    const message = await interaction.fetchReply();
    await setTicketMessage(ticket.id, message.id);
    return;
  }

  if (sub === 'transfer') {
    if (!admin(interaction)) {
      return interaction.reply({
        content: 'You need Manage Server permission.',
        ephemeral: true,
      });
    }

    const number = parseTicketNumber(
      interaction.options.getString('ticket', true),
    );
    const user = interaction.options.getUser('user', true);

    const result = await transferTicket(
      interaction.guildId,
      number,
      user.id,
    );

    if (!result.ok) {
      return interaction.reply({
        content: result.message,
        ephemeral: true,
      });
    }

    await refreshTicket(interaction.client, result.ticket.id);

    return interaction.reply({
      content: `GW-${String(number).padStart(4, '0')} transferred to <@${user.id}>.`,
      ephemeral: true,
    });
  }
}

export async function handleAuthModal(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const token = interaction.fields.getTextInputValue('token').trim();
  const user = await authenticatedUser(token);

  await saveCredential(
    interaction.guildId,
    encryptSecret(token),
    user,
    interaction.user.id,
  );

  return interaction.editReply(
    `✅ GitHub access connected as \`${user.login}\`.`,
  );
}
