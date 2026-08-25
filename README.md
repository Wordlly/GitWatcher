\
# GitWatcher V1

A small Discord + GitHub ticket bot for a private development server.

## V1 features

- Watches one GitHub repository.
- Only processes pushes to `main` (or `WATCHED_BRANCH`).
- `/gitwatcher assign @user "Task title"`
- `/gitwatcher ffa "Task title" slots`
- Ticket acceptance with Discord buttons.
- Discord ↔ GitHub username linking.
- Commit-to-ticket matching:
  1. Ticket code such as `GW-0001` anywhere in the first commit-message line.
  2. Exact ticket title, case-insensitive.
- Commit author must be an accepted ticket assignee.
- Automatically marks the original Discord ticket as completed.
- Only accepted assignees can press **Sign Off**.
- FFA tickets close only after every accepted assignee signs off.
- `/gitwatcher transfer GW-0001 @newuser`
- Optional Git log channel.
- SQLite database.
- GitHub webhook signature verification.
- Docker deployment.

## Recommended workflow

1. Admin creates:
   `/gitwatcher assign @john description:Setup development notes`

2. John presses **Accept Ticket**.

3. John links Discord to GitHub once:
   `/gitwatcher link github_username:johnsmith`

4. John works normally.

5. A commit eventually reaches `main`:
   `git commit -m "GW-0001 Setup development notes"`

6. GitHub sends a signed push webhook.

7. GitWatcher verifies:
   - correct repository;
   - `refs/heads/main`;
   - ticket is in progress;
   - commit message matches;
   - GitHub identity belongs to an accepted assignee.

8. Discord ticket changes to **Task has been completed**.

9. Assignee presses **Sign Off**.

10. Ticket changes to **Ticket has been closed**.

## Local setup

### 1. Create Discord application

In the Discord Developer Portal:

- Create an application.
- Create a bot.
- Copy the bot token.
- Invite it with:
  - `bot`
  - `applications.commands`
- Recommended bot permissions:
  - View Channels
  - Send Messages
  - Embed Links
  - Read Message History

V1 does not require the bot to manage Discord roles.

### 2. Environment

Copy:

```bash
cp .env.example .env
```

Fill in:

```env
DISCORD_TOKEN=...
DISCORD_GUILD_ID=...
GITHUB_WEBHOOK_SECRET=...
WATCHED_REPO=owner/WLPT
WATCHED_BRANCH=main
LOG_CHANNEL_ID=...
DATABASE_PATH=/data/gitwatcher.db
PORT=8080
```

Generate a strong webhook secret, for example:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 3. Run with Docker

```bash
docker compose up --build
```

Health check:

```text
GET http://localhost:8080/health
```

## GitHub webhook

Repository:

`Settings → Webhooks → Add webhook`

Payload URL:

```text
https://YOUR_PUBLIC_HOST/github/webhook
```

Content type:

```text
application/json
```

Secret:

Use the exact value of `GITHUB_WEBHOOK_SECRET`.

Events:

```text
Just the push event
```

Enable SSL verification.

## AWS V1 recommendation

For SQLite, use **one small EC2 instance with Docker** rather than a horizontally
scaling service. The SQLite file lives in the Docker volume and persists on the
instance's EBS storage.

Basic shape:

```text
Internet
   |
 HTTPS :443
   |
 reverse proxy / TLS
   |
 GitWatcher container :8080
   |             |
 Discord        SQLite volume
 gateway        /data/gitwatcher.db
   |
 GitHub webhook
```

A very small private server does not need Redis, RDS, ECS, Kubernetes, SQS, or
multiple workers.

When GitWatcher grows, replace SQLite with Postgres and deploy a stateless bot/API
architecture.

## Exposing the webhook

GitHub needs an HTTPS URL. On EC2, put HTTPS in front of port 8080 using a reverse
proxy such as Caddy or nginx plus a domain name.

For local-only testing, use a temporary HTTPS tunnel and point GitHub's webhook at
that tunnel URL.

## Notes / V1 limitations

- One configured repository per bot process.
- One configured branch.
- GitHub identity is manually linked by username.
- If `commit.author.username` is unavailable, V1 falls back to the GitHub webhook
  sender. This is convenient but not sufficiently strict for a large/public bot.
- Commit matching only checks the first line of each pushed commit message.
- Merge/squash strategies can alter commit messages. Using `GW-####` in the merge
  commit or squash title is recommended.
- No GitHub OAuth yet.
- No GitHub App installation flow yet.
- No web dashboard yet.
- No ticket-role creation yet. Database permissions are authoritative in V1.

## Why ticket roles are not in V1

A role per ticket is useful visually, but it is not needed for security. The bot
already knows exactly which Discord IDs accepted each ticket. This avoids role
clutter and keeps the first version much safer.

A later `/gitwatcher roles enable` option can mirror assignees into temporary
Discord roles while keeping the database as the source of truth.
