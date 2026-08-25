\
import sqlite3
import threading
from pathlib import Path
from typing import Any

from .config import settings

_lock = threading.Lock()


def connection() -> sqlite3.Connection:
    db_path = Path(settings.database_path)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _lock, connection() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                discord_user_id INTEGER PRIMARY KEY,
                github_username TEXT NOT NULL COLLATE NOCASE UNIQUE
            );

            CREATE TABLE IF NOT EXISTS tickets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                code TEXT UNIQUE,
                guild_id INTEGER NOT NULL,
                channel_id INTEGER NOT NULL,
                message_id INTEGER,
                title TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'OPEN',
                max_assignees INTEGER NOT NULL DEFAULT 1,
                ffa INTEGER NOT NULL DEFAULT 0,
                created_by INTEGER NOT NULL,
                commit_sha TEXT,
                completed_by_github TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at TEXT,
                closed_at TEXT
            );

            CREATE TABLE IF NOT EXISTS ticket_assignees (
                ticket_id INTEGER NOT NULL,
                discord_user_id INTEGER NOT NULL,
                accepted INTEGER NOT NULL DEFAULT 0,
                signed_off INTEGER NOT NULL DEFAULT 0,
                accepted_at TEXT,
                signed_off_at TEXT,
                PRIMARY KEY (ticket_id, discord_user_id),
                FOREIGN KEY(ticket_id) REFERENCES tickets(id)
            );
            """
        )


def create_ticket(
    guild_id: int,
    channel_id: int,
    title: str,
    created_by: int,
    assignee_ids: list[int],
    max_assignees: int,
    ffa: bool,
) -> dict[str, Any]:
    with _lock, connection() as conn:
        cur = conn.execute(
            """
            INSERT INTO tickets
            (guild_id, channel_id, title, created_by, max_assignees, ffa)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (guild_id, channel_id, title, created_by, max_assignees, int(ffa)),
        )
        ticket_id = cur.lastrowid
        code = f"GW-{ticket_id:04d}"
        conn.execute("UPDATE tickets SET code=? WHERE id=?", (code, ticket_id))

        for discord_user_id in assignee_ids:
            conn.execute(
                """
                INSERT OR IGNORE INTO ticket_assignees(ticket_id, discord_user_id)
                VALUES (?, ?)
                """,
                (ticket_id, discord_user_id),
            )
        conn.commit()
        return get_ticket(ticket_id, conn)


def set_message_id(ticket_id: int, message_id: int) -> None:
    with _lock, connection() as conn:
        conn.execute("UPDATE tickets SET message_id=? WHERE id=?", (message_id, ticket_id))
        conn.commit()


def get_ticket(ticket_id: int, conn: sqlite3.Connection | None = None):
    own = conn is None
    conn = conn or connection()
    row = conn.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
    if own:
        conn.close()
    return dict(row) if row else None


def get_ticket_by_message(message_id: int):
    with connection() as conn:
        row = conn.execute("SELECT * FROM tickets WHERE message_id=?", (message_id,)).fetchone()
        return dict(row) if row else None


def get_ticket_by_code(code: str):
    with connection() as conn:
        row = conn.execute("SELECT * FROM tickets WHERE code=? COLLATE NOCASE", (code,)).fetchone()
        return dict(row) if row else None


def active_tickets():
    with connection() as conn:
        rows = conn.execute(
            "SELECT * FROM tickets WHERE status NOT IN ('CLOSED','CANCELLED') ORDER BY id DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def ticket_assignees(ticket_id: int):
    with connection() as conn:
        rows = conn.execute(
            "SELECT * FROM ticket_assignees WHERE ticket_id=? ORDER BY discord_user_id",
            (ticket_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def accepted_assignee_ids(ticket_id: int) -> list[int]:
    return [
        row["discord_user_id"]
        for row in ticket_assignees(ticket_id)
        if row["accepted"]
    ]


def all_assignee_ids(ticket_id: int) -> list[int]:
    return [row["discord_user_id"] for row in ticket_assignees(ticket_id)]


def accept_ticket(ticket_id: int, discord_user_id: int) -> tuple[bool, str]:
    with _lock, connection() as conn:
        ticket = conn.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not ticket:
            return False, "Ticket no longer exists."
        if ticket["status"] in ("COMPLETED", "CLOSED", "CANCELLED"):
            return False, "This ticket can no longer be accepted."

        existing = conn.execute(
            """
            SELECT * FROM ticket_assignees
            WHERE ticket_id=? AND discord_user_id=?
            """,
            (ticket_id, discord_user_id),
        ).fetchone()

        accepted_count = conn.execute(
            "SELECT COUNT(*) FROM ticket_assignees WHERE ticket_id=? AND accepted=1",
            (ticket_id,),
        ).fetchone()[0]

        if ticket["ffa"]:
            if existing and existing["accepted"]:
                return False, "You already accepted this ticket."
            if accepted_count >= ticket["max_assignees"]:
                return False, "This ticket is already full."
            conn.execute(
                """
                INSERT INTO ticket_assignees(ticket_id, discord_user_id, accepted, accepted_at)
                VALUES (?, ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(ticket_id, discord_user_id)
                DO UPDATE SET accepted=1, accepted_at=CURRENT_TIMESTAMP
                """,
                (ticket_id, discord_user_id),
            )
        else:
            if not existing:
                return False, "This ticket is assigned to someone else."
            if existing["accepted"]:
                return False, "You already accepted this ticket."
            conn.execute(
                """
                UPDATE ticket_assignees
                SET accepted=1, accepted_at=CURRENT_TIMESTAMP
                WHERE ticket_id=? AND discord_user_id=?
                """,
                (ticket_id, discord_user_id),
            )

        accepted_count = conn.execute(
            "SELECT COUNT(*) FROM ticket_assignees WHERE ticket_id=? AND accepted=1",
            (ticket_id,),
        ).fetchone()[0]

        new_status = "IN_PROGRESS" if accepted_count >= ticket["max_assignees"] else "OPEN"
        conn.execute("UPDATE tickets SET status=? WHERE id=?", (new_status, ticket_id))
        conn.commit()
        return True, "Accepted."


def transfer_ticket(ticket_id: int, new_user_id: int) -> bool:
    with _lock, connection() as conn:
        ticket = conn.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not ticket or ticket["ffa"]:
            return False
        conn.execute("DELETE FROM ticket_assignees WHERE ticket_id=?", (ticket_id,))
        conn.execute(
            """
            INSERT INTO ticket_assignees(ticket_id, discord_user_id, accepted)
            VALUES (?, ?, 0)
            """,
            (ticket_id, new_user_id),
        )
        conn.execute(
            """
            UPDATE tickets
            SET status='OPEN', commit_sha=NULL, completed_by_github=NULL,
                completed_at=NULL, closed_at=NULL
            WHERE id=?
            """,
            (ticket_id,),
        )
        conn.commit()
        return True


def link_user(discord_user_id: int, github_username: str) -> None:
    with _lock, connection() as conn:
        conn.execute(
            """
            INSERT INTO users(discord_user_id, github_username)
            VALUES (?, ?)
            ON CONFLICT(discord_user_id)
            DO UPDATE SET github_username=excluded.github_username
            """,
            (discord_user_id, github_username.strip()),
        )
        conn.commit()


def github_for_discord(discord_user_id: int):
    with connection() as conn:
        row = conn.execute(
            "SELECT github_username FROM users WHERE discord_user_id=?",
            (discord_user_id,),
        ).fetchone()
        return row["github_username"] if row else None


def discord_for_github(github_username: str):
    with connection() as conn:
        row = conn.execute(
            """
            SELECT discord_user_id FROM users
            WHERE github_username=? COLLATE NOCASE
            """,
            (github_username,),
        ).fetchone()
        return row["discord_user_id"] if row else None


def mark_completed(ticket_id: int, sha: str, github_username: str) -> None:
    with _lock, connection() as conn:
        conn.execute(
            """
            UPDATE tickets
            SET status='COMPLETED',
                commit_sha=?,
                completed_by_github=?,
                completed_at=CURRENT_TIMESTAMP
            WHERE id=?
            """,
            (sha, github_username, ticket_id),
        )
        conn.commit()


def sign_off(ticket_id: int, discord_user_id: int) -> tuple[bool, str]:
    with _lock, connection() as conn:
        ticket = conn.execute("SELECT * FROM tickets WHERE id=?", (ticket_id,)).fetchone()
        if not ticket:
            return False, "Ticket not found."
        if ticket["status"] != "COMPLETED":
            return False, "This ticket is not ready for sign-off."

        row = conn.execute(
            """
            SELECT * FROM ticket_assignees
            WHERE ticket_id=? AND discord_user_id=? AND accepted=1
            """,
            (ticket_id, discord_user_id),
        ).fetchone()
        if not row:
            return False, "Only an accepted assignee can sign off this ticket."

        conn.execute(
            """
            UPDATE ticket_assignees
            SET signed_off=1, signed_off_at=CURRENT_TIMESTAMP
            WHERE ticket_id=? AND discord_user_id=?
            """,
            (ticket_id, discord_user_id),
        )

        unsigned = conn.execute(
            """
            SELECT COUNT(*) FROM ticket_assignees
            WHERE ticket_id=? AND accepted=1 AND signed_off=0
            """,
            (ticket_id,),
        ).fetchone()[0]

        if unsigned == 0:
            conn.execute(
                "UPDATE tickets SET status='CLOSED', closed_at=CURRENT_TIMESTAMP WHERE id=?",
                (ticket_id,),
            )

        conn.commit()
        return True, "Signed off."


def find_matching_ticket(commit_message: str):
    message = commit_message.strip()
    candidates = active_tickets()

    # Priority 1: explicit ticket code anywhere in commit message.
    for ticket in candidates:
        if ticket["status"] != "IN_PROGRESS":
            continue
        if ticket["code"].lower() in message.lower():
            return ticket

    # Priority 2: exact title, case-insensitive.
    for ticket in candidates:
        if ticket["status"] != "IN_PROGRESS":
            continue
        if ticket["title"].strip().casefold() == message.casefold():
            return ticket

    return None
