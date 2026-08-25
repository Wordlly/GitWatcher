import {
  ApplicationCommandOptionType,
  PermissionFlagsBits,
} from 'discord.js';

export const gitwatcherCommand = {
  name: 'gitwatcher',
  description: 'Track GitHub development tasks from Discord.',
  options: [
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'help',
      description: 'Show the GitWatcher help menu.',
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'status',
      description: 'Show this server’s GitWatcher status.',
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'auth',
      description: 'Give this server access to private GitHub repos.',
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'auth-status',
      description: 'Check private GitHub access.',
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'auth-remove',
      description: 'Remove private GitHub access.',
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'setuser',
      description: 'Link your Discord account to GitHub.',
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'github',
          description: 'Username or profile URL',
          required: true,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'whoami',
      description: 'Show your linked GitHub account.',
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'webhook',
      description: 'Connect a private repo using a GitHub webhook.',
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'repository',
          description: 'GitHub repository URL',
          required: true,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'watch',
      description: 'Watch a GitHub repo in this channel.',
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'repository',
          description: 'GitHub repository URL',
          required: true,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'unwatch',
      description: 'Stop watching the repo in this channel.',
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'repos',
      description: 'Show this server’s watched repos.',
    },

    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'logs',
      description: 'Log commits from a GitHub branch into this channel.',
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'repository',
          description: 'GitHub repository URL',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'branch',
          description: 'Branch to log, for example main or development',
          required: true,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'unlog',
      description: 'Stop logging a GitHub branch in this channel.',
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'repository',
          description: 'GitHub repository URL',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'branch',
          description: 'Branch to stop logging',
          required: true,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'log-list',
      description: 'Show branch logs configured for this server.',
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'assign',
      description: 'Assign a development task.',
      options: [
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'Person doing the task',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.String,
          name: 'description',
          description: 'Task / commit description',
          required: true,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'ffa',
      description: 'Create a free-for-all development task.',
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'description',
          description: 'Task / commit description',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.Integer,
          name: 'slots',
          description: 'How many people may accept',
          required: true,
          min_value: 1,
          max_value: 10,
        },
      ],
    },
    {
      type: ApplicationCommandOptionType.Subcommand,
      name: 'transfer',
      description: 'Hand a manual ticket to someone else.',
      options: [
        {
          type: ApplicationCommandOptionType.String,
          name: 'ticket',
          description: 'Example: GW-0003',
          required: true,
        },
        {
          type: ApplicationCommandOptionType.User,
          name: 'user',
          description: 'New assignee',
          required: true,
        },
      ],
    },
  ],
};
