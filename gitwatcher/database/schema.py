from .connection import open_pool, pool

def init_db() -> None:
    open_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("""
        CREATE TABLE IF NOT EXISTS guild_settings (
            guild_id BIGINT PRIMARY KEY,
            next_ticket_number INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS github_credentials (
            guild_id BIGINT PRIMARY KEY,
            token_encrypted TEXT NOT NULL,
            github_login TEXT NOT NULL,
            github_user_id BIGINT NOT NULL,
            updated_by BIGINT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS github_users (
            guild_id BIGINT NOT NULL,
            discord_user_id BIGINT NOT NULL,
            github_user_id BIGINT NOT NULL,
            github_login TEXT NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (guild_id, discord_user_id),
            UNIQUE (guild_id, github_user_id)
        );
        CREATE TABLE IF NOT EXISTS repositories (
            id BIGSERIAL PRIMARY KEY,
            guild_id BIGINT NOT NULL,
            channel_id BIGINT,
            owner TEXT NOT NULL,
            repo TEXT NOT NULL,
            branch TEXT NOT NULL DEFAULT 'main',
            is_private BOOLEAN NOT NULL DEFAULT FALSE,
            last_seen_sha TEXT,
            created_by BIGINT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (guild_id, channel_id),
            UNIQUE (guild_id, owner, repo)
        );
        CREATE TABLE IF NOT EXISTS tickets (
            id BIGSERIAL PRIMARY KEY,
            guild_id BIGINT NOT NULL,
            ticket_number INTEGER NOT NULL,
            repository_id BIGINT NOT NULL REFERENCES repositories(id),
            channel_id BIGINT NOT NULL,
            message_id BIGINT,
            title TEXT NOT NULL,
            normalized_title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'OPEN',
            max_assignees INTEGER NOT NULL DEFAULT 1,
            ffa BOOLEAN NOT NULL DEFAULT FALSE,
            created_by BIGINT NOT NULL,
            commit_sha TEXT,
            completed_by_github_id BIGINT,
            completed_by_github_login TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            closed_at TIMESTAMPTZ,
            UNIQUE (guild_id, ticket_number)
        );
        CREATE TABLE IF NOT EXISTS ticket_assignees (
            ticket_id BIGINT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
            discord_user_id BIGINT NOT NULL,
            accepted BOOLEAN NOT NULL DEFAULT FALSE,
            signed_off BOOLEAN NOT NULL DEFAULT FALSE,
            accepted_at TIMESTAMPTZ,
            signed_off_at TIMESTAMPTZ,
            PRIMARY KEY (ticket_id, discord_user_id)
        );
        CREATE INDEX IF NOT EXISTS idx_ticket_repo_status ON tickets(repository_id, status);
        CREATE INDEX IF NOT EXISTS idx_ticket_message ON tickets(guild_id, message_id);
        """)
