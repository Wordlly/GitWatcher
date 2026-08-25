from .connection import pool

def normalize_title(value: str) -> str:
    return " ".join(value.strip().split()).casefold()

def _next_ticket_number(cur, guild_id):
    cur.execute("""
    INSERT INTO guild_settings(guild_id, next_ticket_number)
    VALUES (%s,1) ON CONFLICT (guild_id) DO NOTHING
    """, (guild_id,))
    cur.execute("SELECT next_ticket_number FROM guild_settings WHERE guild_id=%s FOR UPDATE", (guild_id,))
    number = cur.fetchone()["next_ticket_number"]
    cur.execute("UPDATE guild_settings SET next_ticket_number=next_ticket_number+1 WHERE guild_id=%s", (guild_id,))
    return number

def create_ticket(guild_id, repository_id, channel_id, title, created_by, assignee_ids, max_assignees, ffa):
    title = " ".join(title.strip().split())
    normalized = normalize_title(title)
    with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        number = _next_ticket_number(cur, guild_id)
        cur.execute("""
        INSERT INTO tickets
            (guild_id,ticket_number,repository_id,channel_id,title,normalized_title,created_by,max_assignees,ffa)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
        RETURNING *
        """, (guild_id, number, repository_id, channel_id, title, normalized, created_by, max_assignees, ffa))
        ticket = cur.fetchone()
        for user_id in assignee_ids:
            cur.execute("""
            INSERT INTO ticket_assignees(ticket_id,discord_user_id) VALUES (%s,%s)
            ON CONFLICT DO NOTHING
            """, (ticket["id"], user_id))
        return ticket

def set_message_id(ticket_id, message_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("UPDATE tickets SET message_id=%s WHERE id=%s", (message_id, ticket_id))

def get_ticket(ticket_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE id=%s", (ticket_id,))
        return cur.fetchone()

def get_ticket_by_message(guild_id, message_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE guild_id=%s AND message_id=%s", (guild_id, message_id))
        return cur.fetchone()

def ticket_assignees(ticket_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT * FROM ticket_assignees WHERE ticket_id=%s ORDER BY accepted_at NULLS LAST, discord_user_id", (ticket_id,))
        return cur.fetchall()

def accepted_assignee_ids(ticket_id):
    return [r["discord_user_id"] for r in ticket_assignees(ticket_id) if r["accepted"]]

def accept_ticket(ticket_id, discord_user_id):
    with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE id=%s FOR UPDATE", (ticket_id,))
        ticket = cur.fetchone()
        if not ticket:
            return False, "Ticket not found."
        if ticket["status"] not in ("OPEN", "IN_PROGRESS"):
            return False, "This ticket can no longer be accepted."
        cur.execute("SELECT * FROM ticket_assignees WHERE ticket_id=%s AND discord_user_id=%s", (ticket_id, discord_user_id))
        existing = cur.fetchone()
        cur.execute("SELECT COUNT(*) AS count FROM ticket_assignees WHERE ticket_id=%s AND accepted=TRUE", (ticket_id,))
        accepted_count = cur.fetchone()["count"]
        if ticket["ffa"]:
            if existing and existing["accepted"]:
                return False, "You already accepted this ticket."
            if accepted_count >= ticket["max_assignees"]:
                return False, "This ticket is already full."
            cur.execute("""
            INSERT INTO ticket_assignees(ticket_id,discord_user_id,accepted,accepted_at)
            VALUES (%s,%s,TRUE,NOW())
            ON CONFLICT (ticket_id,discord_user_id) DO UPDATE SET accepted=TRUE, accepted_at=NOW()
            """, (ticket_id, discord_user_id))
        else:
            if not existing:
                return False, "This ticket is assigned to someone else."
            if existing["accepted"]:
                return False, "You already accepted this ticket."
            cur.execute("UPDATE ticket_assignees SET accepted=TRUE, accepted_at=NOW() WHERE ticket_id=%s AND discord_user_id=%s", (ticket_id, discord_user_id))
        cur.execute("SELECT COUNT(*) AS count FROM ticket_assignees WHERE ticket_id=%s AND accepted=TRUE", (ticket_id,))
        accepted_count = cur.fetchone()["count"]
        status = "IN_PROGRESS" if accepted_count >= ticket["max_assignees"] else "OPEN"
        cur.execute("UPDATE tickets SET status=%s WHERE id=%s", (status, ticket_id))
        return True, "Ticket accepted."

def transfer_ticket(guild_id, ticket_number, new_user_id):
    with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE guild_id=%s AND ticket_number=%s FOR UPDATE", (guild_id, ticket_number))
        ticket = cur.fetchone()
        if not ticket:
            return False, "Ticket not found.", None
        if ticket["ffa"]:
            return False, "FFA tickets cannot be transferred in the MVP.", ticket
        if ticket["status"] == "CLOSED":
            return False, "Closed tickets cannot be transferred.", ticket
        cur.execute("DELETE FROM ticket_assignees WHERE ticket_id=%s", (ticket["id"],))
        cur.execute("INSERT INTO ticket_assignees(ticket_id,discord_user_id) VALUES (%s,%s)", (ticket["id"], new_user_id))
        cur.execute("""
        UPDATE tickets SET status='OPEN', commit_sha=NULL, completed_by_github_id=NULL,
            completed_by_github_login=NULL, completed_at=NULL, closed_at=NULL
        WHERE id=%s
        """, (ticket["id"],))
        return True, "Ticket transferred.", ticket

def matching_tickets(repository_id, normalized_description, discord_user_id):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("""
        SELECT t.* FROM tickets t
        JOIN ticket_assignees a ON a.ticket_id=t.id
        WHERE t.repository_id=%s AND t.status='IN_PROGRESS' AND t.normalized_title=%s
          AND a.discord_user_id=%s AND a.accepted=TRUE
        ORDER BY t.id
        """, (repository_id, normalized_description, discord_user_id))
        return cur.fetchall()

def mark_completed(ticket_id, sha, github_user_id, github_login):
    with pool.connection() as conn, conn.cursor() as cur:
        cur.execute("""
        UPDATE tickets SET status='COMPLETED', commit_sha=%s, completed_by_github_id=%s,
            completed_by_github_login=%s, completed_at=NOW()
        WHERE id=%s AND status='IN_PROGRESS'
        """, (sha, github_user_id, github_login, ticket_id))

def sign_off(ticket_id, discord_user_id):
    with pool.connection() as conn, conn.transaction(), conn.cursor() as cur:
        cur.execute("SELECT * FROM tickets WHERE id=%s FOR UPDATE", (ticket_id,))
        ticket = cur.fetchone()
        if not ticket:
            return False, "Ticket not found."
        if ticket["status"] != "COMPLETED":
            return False, "This ticket is not ready for sign-off."
        cur.execute("""
        SELECT * FROM ticket_assignees WHERE ticket_id=%s AND discord_user_id=%s AND accepted=TRUE
        """, (ticket_id, discord_user_id))
        if not cur.fetchone():
            return False, "Only an accepted assignee can sign off this ticket."
        cur.execute("UPDATE ticket_assignees SET signed_off=TRUE, signed_off_at=NOW() WHERE ticket_id=%s AND discord_user_id=%s", (ticket_id, discord_user_id))
        cur.execute("SELECT COUNT(*) AS count FROM ticket_assignees WHERE ticket_id=%s AND accepted=TRUE AND signed_off=FALSE", (ticket_id,))
        if cur.fetchone()["count"] == 0:
            cur.execute("UPDATE tickets SET status='CLOSED', closed_at=NOW() WHERE id=%s", (ticket_id,))
        return True, "Signed off."
