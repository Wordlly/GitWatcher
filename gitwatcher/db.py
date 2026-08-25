
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from .config import settings

pool = ConnectionPool(
    conninfo=settings.database_url,
    kwargs={"autocommit": True, "row_factory": dict_row},
    min_size=1,
    max_size=5,
    open=False,
)

def open_pool():
    if pool.closed:
        pool.open(wait=True)

def close_pool():
    if not pool.closed:
        pool.close()

def init_db():
    open_pool()
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            discord_user_id BIGINT PRIMARY KEY,
            github_username TEXT NOT NULL UNIQUE
        );

        CREATE TABLE IF NOT EXISTS repositories (
            id BIGSERIAL PRIMARY KEY,
            guild_id BIGINT NOT NULL,
            channel_id BIGINT NOT NULL,
            owner TEXT NOT NULL,
            repo TEXT NOT NULL,
            branch TEXT NOT NULL DEFAULT 'main',
            last_seen_sha TEXT,
            created_by BIGINT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE(guild_id, owner, repo)
        );

        CREATE TABLE IF NOT EXISTS tickets (
            id BIGSERIAL PRIMARY KEY,
            code TEXT UNIQUE,
            guild_id BIGINT NOT NULL,
            channel_id BIGINT NOT NULL,
            message_id BIGINT,
            repository_id BIGINT REFERENCES repositories(id) ON DELETE SET NULL,
            title TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'OPEN',
            max_assignees INTEGER NOT NULL DEFAULT 1,
            ffa BOOLEAN NOT NULL DEFAULT FALSE,
            created_by BIGINT NOT NULL,
            commit_sha TEXT,
            completed_by_github TEXT,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at TIMESTAMPTZ,
            closed_at TIMESTAMPTZ
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

        ALTER TABLE tickets ADD COLUMN IF NOT EXISTS repository_id BIGINT;
        CREATE INDEX IF NOT EXISTS idx_tickets_message_id ON tickets(message_id);
        CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);
        CREATE INDEX IF NOT EXISTS idx_tickets_repository ON tickets(repository_id);
        CREATE INDEX IF NOT EXISTS idx_users_github_lower ON users(LOWER(github_username));
        """)

def add_repository(guild_id, channel_id, owner, repo, branch, created_by):
    with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("""
        INSERT INTO repositories(guild_id, channel_id, owner, repo, branch, created_by)
        VALUES (%s,%s,%s,%s,%s,%s)
        ON CONFLICT(guild_id, owner, repo)
        DO UPDATE SET channel_id=EXCLUDED.channel_id, branch=EXCLUDED.branch
        RETURNING *
        """, (guild_id, channel_id, owner, repo, branch, created_by))
        return cur.fetchone()

def list_repositories(guild_id=None):
    with pool.connection() as conn, conn.cursor() as cur:
        if guild_id:
            cur.execute("SELECT * FROM repositories WHERE guild_id=%s ORDER BY id", (guild_id,))
        else:
            cur.execute("SELECT * FROM repositories ORDER BY id")
        return cur.fetchall()

def remove_repository(guild_id, owner, repo):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("""
        DELETE FROM repositories
        WHERE guild_id=%s AND LOWER(owner)=LOWER(%s) AND LOWER(repo)=LOWER(%s)
        """, (guild_id, owner, repo))
        return cur.rowcount > 0

def set_last_seen_sha(repo_id, sha):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE repositories SET last_seen_sha=%s WHERE id=%s", (sha, repo_id))

def create_ticket(guild_id, channel_id, title, created_by, assignee_ids,
                  max_assignees, ffa, repository_id):
    with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("""
        INSERT INTO tickets
        (guild_id, channel_id, title, created_by, max_assignees, ffa, repository_id)
        VALUES (%s,%s,%s,%s,%s,%s,%s)
        RETURNING id
        """, (guild_id, channel_id, title, created_by, max_assignees, ffa, repository_id))
        ticket_id = cur.fetchone()["id"]
        code = f"GW-{ticket_id:04d}"
        cur.execute("UPDATE tickets SET code=%s WHERE id=%s", (code, ticket_id))
        for user_id in assignee_ids:
            cur.execute("""
            INSERT INTO ticket_assignees(ticket_id, discord_user_id)
            VALUES (%s,%s) ON CONFLICT DO NOTHING
            """, (ticket_id, user_id))
    return get_ticket(ticket_id)

def set_message_id(ticket_id, message_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE tickets SET message_id=%s WHERE id=%s", (message_id, ticket_id))

def get_ticket(ticket_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE id=%s", (ticket_id,))
        return cur.fetchone()

def get_ticket_by_message(message_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE message_id=%s", (message_id,))
        return cur.fetchone()

def get_ticket_by_code(code):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE LOWER(code)=LOWER(%s)", (code,))
        return cur.fetchone()

def active_tickets(repository_id=None):
    with pool.connection() as conn, conn.cursor() as cur:
        if repository_id is None:
            cur.execute("""
            SELECT * FROM tickets
            WHERE status NOT IN ('CLOSED','CANCELLED') ORDER BY id DESC
            """)
        else:
            cur.execute("""
            SELECT * FROM tickets
            WHERE status NOT IN ('CLOSED','CANCELLED')
              AND repository_id=%s
            ORDER BY id DESC
            """, (repository_id,))
        return cur.fetchall()

def ticket_assignees(ticket_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("""
        SELECT * FROM ticket_assignees
        WHERE ticket_id=%s ORDER BY discord_user_id
        """, (ticket_id,))
        return cur.fetchall()

def accepted_assignee_ids(ticket_id):
    return [r["discord_user_id"] for r in ticket_assignees(ticket_id) if r["accepted"]]

def accept_ticket(ticket_id, discord_user_id):
    with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE id=%s FOR UPDATE", (ticket_id,))
        ticket = cur.fetchone()
        if not ticket:
            return False, "Ticket no longer exists."
        if ticket["status"] in ("COMPLETED","CLOSED","CANCELLED"):
            return False, "This ticket can no longer be accepted."

        cur.execute("""
        SELECT * FROM ticket_assignees WHERE ticket_id=%s AND discord_user_id=%s
        """, (ticket_id, discord_user_id))
        existing = cur.fetchone()

        cur.execute("""
        SELECT COUNT(*) AS count FROM ticket_assignees
        WHERE ticket_id=%s AND accepted=TRUE
        """, (ticket_id,))
        count = cur.fetchone()["count"]

        if ticket["ffa"]:
            if existing and existing["accepted"]:
                return False, "You already accepted this ticket."
            if count >= ticket["max_assignees"]:
                return False, "This ticket is already full."
            cur.execute("""
            INSERT INTO ticket_assignees(ticket_id, discord_user_id, accepted, accepted_at)
            VALUES (%s,%s,TRUE,NOW())
            ON CONFLICT(ticket_id, discord_user_id)
            DO UPDATE SET accepted=TRUE, accepted_at=NOW()
            """, (ticket_id, discord_user_id))
        else:
            if not existing:
                return False, "This ticket is assigned to someone else."
            if existing["accepted"]:
                return False, "You already accepted this ticket."
            cur.execute("""
            UPDATE ticket_assignees SET accepted=TRUE, accepted_at=NOW()
            WHERE ticket_id=%s AND discord_user_id=%s
            """, (ticket_id, discord_user_id))

        cur.execute("""
        SELECT COUNT(*) AS count FROM ticket_assignees
        WHERE ticket_id=%s AND accepted=TRUE
        """, (ticket_id,))
        count = cur.fetchone()["count"]
        status = "IN_PROGRESS" if count >= ticket["max_assignees"] else "OPEN"
        cur.execute("UPDATE tickets SET status=%s WHERE id=%s", (status, ticket_id))
    return True, "Accepted."

def transfer_ticket(ticket_id, new_user_id):
    with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE id=%s FOR UPDATE", (ticket_id,))
        ticket = cur.fetchone()
        if not ticket or ticket["ffa"]:
            return False
        cur.execute("DELETE FROM ticket_assignees WHERE ticket_id=%s", (ticket_id,))
        cur.execute("""
        INSERT INTO ticket_assignees(ticket_id, discord_user_id, accepted)
        VALUES (%s,%s,FALSE)
        """, (ticket_id, new_user_id))
        cur.execute("""
        UPDATE tickets SET status='OPEN', commit_sha=NULL,
        completed_by_github=NULL, completed_at=NULL, closed_at=NULL
        WHERE id=%s
        """, (ticket_id,))
    return True

def link_user(discord_user_id, github_username):
    username = github_username.strip()
    with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("""
        DELETE FROM users
        WHERE LOWER(github_username)=LOWER(%s) AND discord_user_id<>%s
        """, (username, discord_user_id))
        cur.execute("""
        INSERT INTO users(discord_user_id, github_username)
        VALUES (%s,%s)
        ON CONFLICT(discord_user_id)
        DO UPDATE SET github_username=EXCLUDED.github_username
        """, (discord_user_id, username))

def discord_for_github(github_username):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("""
        SELECT discord_user_id FROM users
        WHERE LOWER(github_username)=LOWER(%s)
        """, (github_username,))
        row = cur.fetchone()
        return row["discord_user_id"] if row else None

def mark_completed(ticket_id, sha, github_username):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("""
        UPDATE tickets SET status='COMPLETED', commit_sha=%s,
        completed_by_github=%s, completed_at=NOW()
        WHERE id=%s
        """, (sha, github_username, ticket_id))

def sign_off(ticket_id, discord_user_id):
    with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE id=%s FOR UPDATE", (ticket_id,))
        ticket = cur.fetchone()
        if not ticket:
            return False, "Ticket not found."
        if ticket["status"] != "COMPLETED":
            return False, "This ticket is not ready for sign-off."
        cur.execute("""
        SELECT * FROM ticket_assignees
        WHERE ticket_id=%s AND discord_user_id=%s AND accepted=TRUE
        """, (ticket_id, discord_user_id))
        if not cur.fetchone():
            return False, "Only an accepted assignee can sign off this ticket."
        cur.execute("""
        UPDATE ticket_assignees
        SET signed_off=TRUE, signed_off_at=NOW()
        WHERE ticket_id=%s AND discord_user_id=%s
        """, (ticket_id, discord_user_id))
        cur.execute("""
        SELECT COUNT(*) AS count FROM ticket_assignees
        WHERE ticket_id=%s AND accepted=TRUE AND signed_off=FALSE
        """, (ticket_id,))
        if cur.fetchone()["count"] == 0:
            cur.execute("""
            UPDATE tickets SET status='CLOSED', closed_at=NOW() WHERE id=%s
            """, (ticket_id,))
    return True, "Signed off."

def normalize_description(text):
    return " ".join(text.strip().split()).casefold()

def find_matching_ticket(repository_id, commit_message):
    message = normalize_description(commit_message.splitlines()[0])
    if not message:
        return None
    for ticket in active_tickets(repository_id):
        if ticket["status"] != "IN_PROGRESS":
            continue
        if normalize_description(ticket["title"]) == message:
            return ticket
    return None
