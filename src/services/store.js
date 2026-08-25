import { pool } from '../db/pool.js';

export function normalizeTitle(value) {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

export async function saveCredential(guildId, encrypted, user, updatedBy) {
  await pool.query(
    `
    INSERT INTO github_credentials
      (guild_id, token_encrypted, github_login, github_user_id, updated_by, updated_at)
    VALUES ($1,$2,$3,$4,$5,NOW())
    ON CONFLICT (guild_id)
    DO UPDATE SET
      token_encrypted=EXCLUDED.token_encrypted,
      github_login=EXCLUDED.github_login,
      github_user_id=EXCLUDED.github_user_id,
      updated_by=EXCLUDED.updated_by,
      updated_at=NOW()
    `,
    [guildId, encrypted, user.login, user.id, updatedBy],
  );
}

export async function credentialStatus(guildId) {
  const { rows } = await pool.query(
    'SELECT github_login FROM github_credentials WHERE guild_id=$1',
    [guildId],
  );
  return rows[0] || null;
}

export async function removeCredential(guildId) {
  const result = await pool.query(
    'DELETE FROM github_credentials WHERE guild_id=$1',
    [guildId],
  );
  return result.rowCount > 0;
}

export async function setUser(guildId, discordUserId, githubUser) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const claimed = await client.query(
      `
      SELECT discord_user_id
      FROM github_users
      WHERE guild_id=$1 AND github_user_id=$2
      `,
      [guildId, githubUser.id],
    );

    if (
      claimed.rows[0] &&
      claimed.rows[0].discord_user_id !== discordUserId
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        discordUserId: claimed.rows[0].discord_user_id,
      };
    }

    await client.query(
      `
      INSERT INTO github_users
        (guild_id, discord_user_id, github_user_id, github_login, updated_at)
      VALUES ($1,$2,$3,$4,NOW())
      ON CONFLICT (guild_id, discord_user_id)
      DO UPDATE SET
        github_user_id=EXCLUDED.github_user_id,
        github_login=EXCLUDED.github_login,
        updated_at=NOW()
      `,
      [guildId, discordUserId, githubUser.id, githubUser.login],
    );

    await client.query('COMMIT');
    return { ok: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function whoami(guildId, discordUserId) {
  const { rows } = await pool.query(
    `
    SELECT github_user_id, github_login
    FROM github_users
    WHERE guild_id=$1 AND discord_user_id=$2
    `,
    [guildId, discordUserId],
  );
  return rows[0] || null;
}

export async function discordForGithub(guildId, githubUserId) {
  const { rows } = await pool.query(
    `
    SELECT discord_user_id
    FROM github_users
    WHERE guild_id=$1 AND github_user_id=$2
    `,
    [guildId, githubUserId],
  );
  return rows[0]?.discord_user_id || null;
}

export async function watchRepo(guildId, channelId, repo, createdBy) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    await client.query(
      `
      UPDATE repositories
      SET active=FALSE, channel_id=NULL
      WHERE guild_id=$1 AND channel_id=$2 AND active=TRUE
      `,
      [guildId, channelId],
    );

    const result = await client.query(
      `
      INSERT INTO repositories
        (guild_id, channel_id, owner, repo, branch, is_private,
         last_seen_sha, active, created_by)
      VALUES ($1,$2,$3,$4,'main',$5,$6,TRUE,$7)
      ON CONFLICT (guild_id, owner, repo)
      DO UPDATE SET
        channel_id=EXCLUDED.channel_id,
        branch='main',
        is_private=EXCLUDED.is_private,
        last_seen_sha=EXCLUDED.last_seen_sha,
        active=TRUE,
        created_by=EXCLUDED.created_by
      RETURNING *
      `,
      [
        guildId,
        channelId,
        repo.owner,
        repo.repo,
        repo.isPrivate,
        repo.headSha,
        createdBy,
      ],
    );

    await client.query('COMMIT');
    return result.rows[0];
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function repoForChannel(guildId, channelId) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM repositories
    WHERE guild_id=$1 AND channel_id=$2 AND active=TRUE
    `,
    [guildId, channelId],
  );
  return rows[0] || null;
}

export async function reposForGuild(guildId) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM repositories
    WHERE guild_id=$1 AND active=TRUE
    ORDER BY channel_id
    `,
    [guildId],
  );
  return rows;
}

export async function allActiveRepos() {
  const { rows } = await pool.query(
    'SELECT * FROM repositories WHERE active=TRUE ORDER BY id',
  );
  return rows;
}

export async function unwatchChannel(guildId, channelId) {
  const result = await pool.query(
    `
    UPDATE repositories
    SET active=FALSE, channel_id=NULL
    WHERE guild_id=$1 AND channel_id=$2 AND active=TRUE
    `,
    [guildId, channelId],
  );
  return result.rowCount > 0;
}

async function nextTicketNumber(client, guildId) {
  await client.query(
    `
    INSERT INTO guild_settings(guild_id, next_ticket_number)
    VALUES ($1,1)
    ON CONFLICT (guild_id) DO NOTHING
    `,
    [guildId],
  );

  const result = await client.query(
    `
    SELECT next_ticket_number
    FROM guild_settings
    WHERE guild_id=$1
    FOR UPDATE
    `,
    [guildId],
  );

  const number = result.rows[0].next_ticket_number;

  await client.query(
    `
    UPDATE guild_settings
    SET next_ticket_number=next_ticket_number+1
    WHERE guild_id=$1
    `,
    [guildId],
  );

  return number;
}

export async function createTicket({
  guildId,
  channelId,
  repositoryId,
  title,
  createdBy,
  assignees,
  maxAssignees,
  ffa,
}) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const number = await nextTicketNumber(client, guildId);
    const cleanTitle = title.trim().replace(/\s+/g, ' ');

    const result = await client.query(
      `
      INSERT INTO tickets
        (guild_id, ticket_number, repository_id, channel_id, title,
         normalized_title, status, max_assignees, ffa, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,'OPEN',$7,$8,$9)
      RETURNING *
      `,
      [
        guildId,
        number,
        repositoryId,
        channelId,
        cleanTitle,
        normalizeTitle(cleanTitle),
        maxAssignees,
        ffa,
        createdBy,
      ],
    );

    const ticket = result.rows[0];

    for (const userId of assignees) {
      await client.query(
        `
        INSERT INTO ticket_assignees(ticket_id, discord_user_id)
        VALUES ($1,$2)
        `,
        [ticket.id, userId],
      );
    }

    await client.query('COMMIT');
    return ticket;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function setTicketMessage(ticketId, messageId) {
  await pool.query(
    'UPDATE tickets SET message_id=$1 WHERE id=$2',
    [messageId, ticketId],
  );
}

export async function ticketById(ticketId) {
  const { rows } = await pool.query(
    'SELECT * FROM tickets WHERE id=$1',
    [ticketId],
  );
  return rows[0] || null;
}

export async function ticketByNumber(guildId, number) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM tickets
    WHERE guild_id=$1 AND ticket_number=$2
    `,
    [guildId, number],
  );
  return rows[0] || null;
}

export async function ticketAssignees(ticketId) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM ticket_assignees
    WHERE ticket_id=$1
    ORDER BY accepted_at NULLS LAST, discord_user_id
    `,
    [ticketId],
  );
  return rows;
}

export async function acceptTicket(ticketId, guildId, discordUserId) {
  const linked = await whoami(guildId, discordUserId);
  if (!linked) {
    return {
      ok: false,
      message: 'Link GitHub first with /gitwatcher setuser.',
    };
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const ticketResult = await client.query(
      'SELECT * FROM tickets WHERE id=$1 FOR UPDATE',
      [ticketId],
    );
    const ticket = ticketResult.rows[0];

    if (!ticket) {
      await client.query('ROLLBACK');
      return { ok: false, message: 'Ticket not found.' };
    }

    if (!['OPEN', 'IN_PROGRESS'].includes(ticket.status)) {
      await client.query('ROLLBACK');
      return { ok: false, message: 'This ticket can no longer be accepted.' };
    }

    const existing = await client.query(
      `
      SELECT *
      FROM ticket_assignees
      WHERE ticket_id=$1 AND discord_user_id=$2
      `,
      [ticketId, discordUserId],
    );

    const countResult = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM ticket_assignees
      WHERE ticket_id=$1 AND accepted=TRUE
      `,
      [ticketId],
    );

    const count = countResult.rows[0].count;

    if (ticket.ffa) {
      if (existing.rows[0]?.accepted) {
        await client.query('ROLLBACK');
        return { ok: false, message: 'You already accepted this ticket.' };
      }

      if (count >= ticket.max_assignees) {
        await client.query('ROLLBACK');
        return { ok: false, message: 'This ticket is already full.' };
      }

      await client.query(
        `
        INSERT INTO ticket_assignees
          (ticket_id, discord_user_id, accepted, accepted_at)
        VALUES ($1,$2,TRUE,NOW())
        ON CONFLICT (ticket_id, discord_user_id)
        DO UPDATE SET accepted=TRUE, accepted_at=NOW()
        `,
        [ticketId, discordUserId],
      );
    } else {
      if (!existing.rows[0]) {
        await client.query('ROLLBACK');
        return { ok: false, message: 'This ticket is assigned to someone else.' };
      }

      if (existing.rows[0].accepted) {
        await client.query('ROLLBACK');
        return { ok: false, message: 'You already accepted this ticket.' };
      }

      await client.query(
        `
        UPDATE ticket_assignees
        SET accepted=TRUE, accepted_at=NOW()
        WHERE ticket_id=$1 AND discord_user_id=$2
        `,
        [ticketId, discordUserId],
      );
    }

    const after = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM ticket_assignees
      WHERE ticket_id=$1 AND accepted=TRUE
      `,
      [ticketId],
    );

    const status =
      after.rows[0].count >= ticket.max_assignees
        ? 'IN_PROGRESS'
        : 'OPEN';

    await client.query(
      'UPDATE tickets SET status=$1 WHERE id=$2',
      [status, ticketId],
    );

    await client.query('COMMIT');
    return { ok: true, message: 'Ticket accepted.' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function signOffTicket(ticketId, discordUserId) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const ticketResult = await client.query(
      'SELECT * FROM tickets WHERE id=$1 FOR UPDATE',
      [ticketId],
    );
    const ticket = ticketResult.rows[0];

    if (!ticket || ticket.status !== 'COMPLETED') {
      await client.query('ROLLBACK');
      return { ok: false, message: 'This ticket is not ready for sign-off.' };
    }

    const member = await client.query(
      `
      SELECT *
      FROM ticket_assignees
      WHERE ticket_id=$1 AND discord_user_id=$2 AND accepted=TRUE
      `,
      [ticketId, discordUserId],
    );

    if (!member.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, message: 'Only an accepted assignee can sign off.' };
    }

    await client.query(
      `
      UPDATE ticket_assignees
      SET signed_off=TRUE, signed_off_at=NOW()
      WHERE ticket_id=$1 AND discord_user_id=$2
      `,
      [ticketId, discordUserId],
    );

    const remaining = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM ticket_assignees
      WHERE ticket_id=$1 AND accepted=TRUE AND signed_off=FALSE
      `,
      [ticketId],
    );

    if (remaining.rows[0].count === 0) {
      await client.query(
        `
        UPDATE tickets
        SET status='CLOSED', closed_at=NOW()
        WHERE id=$1
        `,
        [ticketId],
      );
    }

    await client.query('COMMIT');
    return { ok: true, message: 'Signed off.' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function transferTicket(guildId, number, newUserId) {
  const ticket = await ticketByNumber(guildId, number);

  if (!ticket) return { ok: false, message: 'Ticket not found.' };
  if (ticket.ffa) return { ok: false, message: 'FFA tickets cannot be transferred yet.' };
  if (ticket.status === 'CLOSED') return { ok: false, message: 'Closed tickets cannot be transferred.' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM ticket_assignees WHERE ticket_id=$1', [ticket.id]);
    await client.query(
      'INSERT INTO ticket_assignees(ticket_id, discord_user_id) VALUES ($1,$2)',
      [ticket.id, newUserId],
    );
    await client.query(
      `
      UPDATE tickets
      SET status='OPEN',
          commit_sha=NULL,
          completed_by_github_id=NULL,
          completed_by_github_login=NULL,
          completed_at=NULL,
          closed_at=NULL
      WHERE id=$1
      `,
      [ticket.id],
    );
    await client.query('COMMIT');
    return { ok: true, ticket };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function matchingTickets(repositoryId, normalizedTitle, discordUserId) {
  const { rows } = await pool.query(
    `
    SELECT t.*
    FROM tickets t
    JOIN ticket_assignees a ON a.ticket_id=t.id
    WHERE t.repository_id=$1
      AND t.status='IN_PROGRESS'
      AND t.normalized_title=$2
      AND a.discord_user_id=$3
      AND a.accepted=TRUE
    ORDER BY t.id
    `,
    [repositoryId, normalizedTitle, discordUserId],
  );
  return rows;
}

export async function markCompleted(ticketId, commit, githubUser) {
  await pool.query(
    `
    UPDATE tickets
    SET status='COMPLETED',
        commit_sha=$1,
        completed_by_github_id=$2,
        completed_by_github_login=$3,
        completed_at=NOW()
    WHERE id=$4 AND status='IN_PROGRESS'
    `,
    [commit.sha, githubUser.id, githubUser.login, ticketId],
  );
}

export async function setLastSeen(repositoryId, sha) {
  await pool.query(
    'UPDATE repositories SET last_seen_sha=$1 WHERE id=$2',
    [sha, repositoryId],
  );
}


export async function addBranchLog({
  guildId,
  channelId,
  owner,
  repo,
  branch,
  lastSeenSha,
  createdBy,
}) {
  const { rows } = await pool.query(
    `
    INSERT INTO branch_logs
      (guild_id, channel_id, owner, repo, branch, last_seen_sha, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (guild_id, channel_id, owner, repo, branch)
    DO UPDATE SET
      last_seen_sha=EXCLUDED.last_seen_sha,
      created_by=EXCLUDED.created_by
    RETURNING *
    `,
    [guildId, channelId, owner, repo, branch, lastSeenSha, createdBy],
  );

  return rows[0];
}

export async function removeBranchLog(
  guildId,
  channelId,
  owner,
  repo,
  branch,
) {
  const result = await pool.query(
    `
    DELETE FROM branch_logs
    WHERE guild_id=$1
      AND channel_id=$2
      AND LOWER(owner)=LOWER($3)
      AND LOWER(repo)=LOWER($4)
      AND branch=$5
    `,
    [guildId, channelId, owner, repo, branch],
  );

  return result.rowCount > 0;
}

export async function removeBranchLogById(id) {
  await pool.query(
    'DELETE FROM branch_logs WHERE id=$1',
    [id],
  );
}

export async function allBranchLogs() {
  const { rows } = await pool.query(
    'SELECT * FROM branch_logs ORDER BY id',
  );
  return rows;
}

export async function branchLogsForGuild(guildId) {
  const { rows } = await pool.query(
    `
    SELECT *
    FROM branch_logs
    WHERE guild_id=$1
    ORDER BY channel_id, owner, repo, branch
    `,
    [guildId],
  );
  return rows;
}

export async function setBranchLogLastSeen(id, sha) {
  await pool.query(
    'UPDATE branch_logs SET last_seen_sha=$1 WHERE id=$2',
    [sha, id],
  );
}
