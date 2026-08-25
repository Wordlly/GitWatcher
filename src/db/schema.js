import { pool } from './pool.js';

export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guild_settings (
      guild_id TEXT PRIMARY KEY,
      next_ticket_number INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS github_credentials (
      guild_id TEXT PRIMARY KEY,
      token_encrypted TEXT NOT NULL,
      github_login TEXT NOT NULL,
      github_user_id BIGINT NOT NULL,
      updated_by TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS github_users (
      guild_id TEXT NOT NULL,
      discord_user_id TEXT NOT NULL,
      github_user_id BIGINT NOT NULL,
      github_login TEXT NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, discord_user_id),
      UNIQUE (guild_id, github_user_id)
    );

    CREATE TABLE IF NOT EXISTS repositories (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL DEFAULT 'main',
      is_private BOOLEAN NOT NULL DEFAULT FALSE,
      last_seen_sha TEXT,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      webhook_only BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, owner, repo)
    );

    ALTER TABLE repositories
      ADD COLUMN IF NOT EXISTS webhook_only BOOLEAN NOT NULL DEFAULT FALSE;

    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id TEXT PRIMARY KEY,
      repository_id BIGINT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
      secret_encrypted TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (repository_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS one_active_repo_per_channel
      ON repositories(guild_id, channel_id)
      WHERE active = TRUE AND channel_id IS NOT NULL;


    CREATE TABLE IF NOT EXISTS branch_logs (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      branch TEXT NOT NULL,
      last_seen_sha TEXT,
      created_by TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (guild_id, channel_id, owner, repo, branch)
    );

    CREATE INDEX IF NOT EXISTS idx_branch_logs_lookup
      ON branch_logs(guild_id, owner, repo, branch);

    CREATE TABLE IF NOT EXISTS repo_event_state (
      guild_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      owner TEXT NOT NULL,
      repo TEXT NOT NULL,
      last_seen_event_id TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (guild_id, channel_id, owner, repo)
    );

    CREATE TABLE IF NOT EXISTS tickets (
      id BIGSERIAL PRIMARY KEY,
      guild_id TEXT NOT NULL,
      ticket_number INTEGER NOT NULL,
      repository_id BIGINT NOT NULL REFERENCES repositories(id),
      channel_id TEXT NOT NULL,
      message_id TEXT,
      title TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'OPEN',
      max_assignees INTEGER NOT NULL DEFAULT 1,
      ffa BOOLEAN NOT NULL DEFAULT FALSE,
      created_by TEXT NOT NULL,
      commit_sha TEXT,
      completed_by_github_id BIGINT,
      completed_by_github_login TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      closed_at TIMESTAMPTZ,
      ticket_role_id TEXT,
      UNIQUE (guild_id, ticket_number)
    );

    ALTER TABLE tickets
      ADD COLUMN IF NOT EXISTS ticket_role_id TEXT;

    CREATE TABLE IF NOT EXISTS ticket_assignees (
      ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      discord_user_id TEXT NOT NULL,
      accepted BOOLEAN NOT NULL DEFAULT FALSE,
      signed_off BOOLEAN NOT NULL DEFAULT FALSE,
      accepted_at TIMESTAMPTZ,
      signed_off_at TIMESTAMPTZ,
      PRIMARY KEY (ticket_id, discord_user_id)
    );

    CREATE INDEX IF NOT EXISTS idx_repositories_guild_active
      ON repositories(guild_id, active);

    CREATE INDEX IF NOT EXISTS idx_tickets_repo_status
      ON tickets(repository_id, status);

    CREATE INDEX IF NOT EXISTS idx_tickets_message
      ON tickets(guild_id, message_id);
  `);
}
