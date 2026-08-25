from .connection import pool

def save_github_credential(guild_id, token_encrypted, github_login, github_user_id, updated_by):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("""
        INSERT INTO github_credentials
            (guild_id, token_encrypted, github_login, github_user_id, updated_by, updated_at)
        VALUES (%s,%s,%s,%s,%s,NOW())
        ON CONFLICT (guild_id) DO UPDATE SET
            token_encrypted=EXCLUDED.token_encrypted,
            github_login=EXCLUDED.github_login,
            github_user_id=EXCLUDED.github_user_id,
            updated_by=EXCLUDED.updated_by,
            updated_at=NOW()
        """, (guild_id, token_encrypted, github_login, github_user_id, updated_by))

def get_github_credential(guild_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM github_credentials WHERE guild_id=%s", (guild_id,))
        return cur.fetchone()

def delete_github_credential(guild_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("DELETE FROM github_credentials WHERE guild_id=%s", (guild_id,))
        return cur.rowcount > 0

def set_github_user(guild_id, discord_user_id, github_user_id, github_login):
    with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("""
        SELECT discord_user_id FROM github_users
        WHERE guild_id=%s AND github_user_id=%s AND discord_user_id<>%s
        """, (guild_id, github_user_id, discord_user_id))
        existing = cur.fetchone()
        if existing:
            return False, existing["discord_user_id"]
        cur.execute("""
        INSERT INTO github_users(guild_id, discord_user_id, github_user_id, github_login, updated_at)
        VALUES (%s,%s,%s,%s,NOW())
        ON CONFLICT (guild_id, discord_user_id) DO UPDATE SET
            github_user_id=EXCLUDED.github_user_id,
            github_login=EXCLUDED.github_login,
            updated_at=NOW()
        """, (guild_id, discord_user_id, github_user_id, github_login))
        return True, None

def get_github_user_for_discord(guild_id, discord_user_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("""
        SELECT * FROM github_users WHERE guild_id=%s AND discord_user_id=%s
        """, (guild_id, discord_user_id))
        return cur.fetchone()

def get_discord_user_for_github_id(guild_id, github_user_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("""
        SELECT discord_user_id FROM github_users
        WHERE guild_id=%s AND github_user_id=%s
        """, (guild_id, github_user_id))
        row = cur.fetchone()
        return row["discord_user_id"] if row else None

def add_repository(guild_id, channel_id, owner, repo, is_private, last_seen_sha, created_by):
    with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        # One active repository per Discord channel. Old repo records remain for ticket history.
        cur.execute("UPDATE repositories SET channel_id=NULL WHERE guild_id=%s AND channel_id=%s", (guild_id, channel_id))
        cur.execute("""
        INSERT INTO repositories
            (guild_id, channel_id, owner, repo, branch, is_private, last_seen_sha, created_by)
        VALUES (%s,%s,%s,%s,'main',%s,%s,%s)
        ON CONFLICT (guild_id, owner, repo) DO UPDATE SET
            channel_id=EXCLUDED.channel_id,
            is_private=EXCLUDED.is_private,
            last_seen_sha=EXCLUDED.last_seen_sha,
            created_by=EXCLUDED.created_by
        RETURNING *
        """, (guild_id, channel_id, owner, repo, is_private, last_seen_sha, created_by))
        return cur.fetchone()

def get_repository_for_channel(guild_id, channel_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("""
        SELECT * FROM repositories WHERE guild_id=%s AND channel_id=%s
        """, (guild_id, channel_id))
        return cur.fetchone()

def list_repositories(guild_id=None):
    with pool.connection() as conn, conn.cursor() as cur:
        if guild_id is None:
            cur.execute("SELECT * FROM repositories WHERE channel_id IS NOT NULL ORDER BY id")
        else:
            cur.execute("SELECT * FROM repositories WHERE guild_id=%s AND channel_id IS NOT NULL ORDER BY channel_id", (guild_id,))
        return cur.fetchall()

def remove_repository_for_channel(guild_id, channel_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE repositories SET channel_id=NULL WHERE guild_id=%s AND channel_id=%s", (guild_id, channel_id))
        return cur.rowcount > 0

def set_last_seen_sha(repository_id, sha):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE repositories SET last_seen_sha=%s WHERE id=%s", (sha, repository_id))
