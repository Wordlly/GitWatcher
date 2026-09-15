# GitWatcher — Local Development Handover

_Last consolidated: 15 September 2026_

This document is intended to let development continue locally without needing the previous chat history. It describes what GitWatcher is, how the current implementation works, what has already been built, what is required to run it, the database and security model, known caveats, and the current development direction.

---

## 1. What GitWatcher is

GitWatcher is a Discord-first GitHub development/task-tracking bot.

The core idea is:

- Discord is where the team manages work.
- GitHub is where developers work normally.
- GitWatcher links the two.
- PostgreSQL stores persistent state.
- Railway currently hosts the bot, but the same code can be run locally.

The intended workflow is deliberately passive for developers. A developer should not need special Git commands or ticket IDs in commit messages. If a ticket is called `Setup development notes`, committing with `Setup development notes` (case-insensitive, repeated spaces ignored) can complete the ticket automatically once the commit reaches the watched `main` branch.

The product is designed so one deployment can serve many Discord servers. Configuration is stored per Discord guild rather than hard-coded in environment variables.

---

## 2. Current source / hosting setup

### Source repository

Current public source repository:

`https://github.com/Wordlly/GitWatcher`

### Hosting

Current deployment target: Railway.

Current public Railway domain used during webhook experiments:

`https://gitwatcher.up.railway.app`

The normal bot does not need that public domain for polling; it is only needed for HTTP health checks and webhook experiments.

### Database

Railway PostgreSQL.

The bot uses PostgreSQL for all persistent state including:

- Discord guild settings
- GitHub credentials
- Discord ↔ GitHub identity mappings
- repository configuration
- tickets
- ticket assignees
- branch logging subscriptions
- branch event checkpoints
- ticket rejection history
- pending reassignment state
- ticket role IDs
- admin log configuration

---

## 3. Current technical stack

- Node.js 20 recommended (`package.json` allows Node >=18)
- JavaScript ES modules (`"type": "module"`)
- Discord.js v14
- PostgreSQL via `pg`
- Axios for GitHub REST API calls
- Express for `/` and `/health` and the paused webhook endpoint
- dotenv for local environment variables
- Railway + Docker for production deployment

Current dependencies:

```json
{
  "axios": "^1.15.0",
  "discord.js": "^14.26.0",
  "dotenv": "^17.2.0",
  "express": "^5.1.0",
  "pg": "^8.16.0"
}
```

Start command:

```bash
npm start
```

which runs:

```bash
node index.js
```

`index.js` simply imports `src/app.js`.

---

## 4. Current project structure

```text
GitWatcher/
├── index.js
├── package.json
├── Dockerfile
├── railway.json
├── README.md
├── LICENSE
└── src/
    ├── app.js
    ├── config.js
    ├── interactions.js
    ├── messages.js
    │
    ├── commands/
    │   ├── definition.js
    │   └── handler.js
    │
    ├── db/
    │   ├── pool.js
    │   └── schema.js
    │
    ├── services/
    │   ├── adminLog.js
    │   ├── crypto.js
    │   ├── github.js
    │   ├── permissions.js
    │   ├── store.js
    │   ├── ticketRoles.js
    │   ├── watcher.js
    │   └── webhook.js     # paused/experimental path
    │
    └── ui/
        └── tickets.js
```

### File responsibilities

**`src/app.js`**
- runs database migration
- creates Discord client
- starts Express server
- registers Discord listeners
- registers global slash command schema
- starts GitHub polling watcher
- logs into Discord

**`src/config.js`**
- reads environment variables
- enforces required Discord/database configuration
- sets polling interval
- supports dedicated encryption key

**`src/commands/definition.js`**
- declares `/gitwatcher` and every subcommand/options Discord should register

**`src/commands/handler.js`**
- implements slash command behaviour
- opens GitHub token modal
- enforces admin/micromanager permissions
- creates tickets / watches repos / sets logs etc.

**`src/interactions.js`**
- handles buttons and modal submissions
- accept, decline, sign off, manual close
- ticket role security checks
- admin log events

**`src/messages.js`**
- handles the special post-decline reassignment workflow
- watches normal Discord messages only when a ticket is waiting for reassignment

**`src/db/schema.js`**
- performs idempotent schema creation/migration on startup

**`src/db/pool.js`**
- creates PostgreSQL connection pool

**`src/services/store.js`**
- main persistence/data layer
- most SQL queries and ticket transitions live here

**`src/services/github.js`**
- GitHub API access
- URL/profile validation
- branch/commit/repo/event lookup
- decrypts stored guild token only when an API call needs it

**`src/services/watcher.js`**
- polling loop
- ticket commit matching
- branch commit logging
- branch creation logging
- checkpoint recovery behaviour

**`src/services/crypto.js`**
- AES-256-GCM encryption/decryption
- dedicated credential encryption key
- legacy migration support

**`src/services/permissions.js`**
- Administrator / Manage Server / Micromanager checks

**`src/services/ticketRoles.js`**
- creates ticket-specific Discord role
- assigns it to accepted users
- checks role possession
- removes role when finished/transferred

**`src/services/adminLog.js`**
- sends security/admin events into the configured admin log channel

**`src/ui/tickets.js`**
- ticket embed text/status/buttons
- edits original ticket message throughout lifecycle

**`src/services/webhook.js`**
- belongs to a webhook experiment that was paused. See Known Issues / Paused Work below.

---

## 5. Startup / execution flow

When GitWatcher starts:

1. `index.js` imports `src/app.js`.
2. `app.js` calls `migrate()`.
3. PostgreSQL schema is created/updated idempotently.
4. A Discord client is created.
5. Express starts listening on `PORT`.
6. Discord interaction and message listeners are attached.
7. Bot logs into Discord using `DISCORD_TOKEN`.
8. On Discord `ready`:
   - `/gitwatcher` global command definition is uploaded to Discord.
   - polling watcher starts.
9. Watcher executes immediately once, then every `POLL_SECONDS`.

Production Docker command:

```dockerfile
CMD ["npm", "start"]
```

Railway health check:

```text
GET /health
```

returns JSON `{ "ok": true }`.

---

## 6. Required environment variables

### Required

```env
DISCORD_TOKEN=...
DATABASE_URL=...
```

or Railway may expose the database as:

```env
POSTGRES_URL=...
```

The code accepts either `POSTGRES_URL` or `DATABASE_URL`.

### Strongly recommended security variable

```env
GITWATCHER_ENCRYPTION_KEY=...
```

Generate a strong local value with:

```bash
openssl rand -base64 32
```

Do not commit any `.env` file.

### Optional

```env
PORT=3000
POLL_SECONDS=300
```

`POLL_SECONDS` has a hard minimum of 60 seconds.

### Example local `.env`

```env
DISCORD_TOKEN=your_discord_bot_token
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gitwatcher
GITWATCHER_ENCRYPTION_KEY=generate-a-real-secret
PORT=3000
POLL_SECONDS=60
```

For local development, 60 seconds is useful for faster testing.

---

## 7. Discord Developer Portal requirements

The bot currently uses these gateway intents:

- `Guilds`
- `GuildMessages`
- `MessageContent`

Because the decline/reassignment workflow needs to read a delegator's later `@mention`, **Message Content Intent must be enabled** in:

Discord Developer Portal → Application → Bot → Privileged Gateway Intents → Message Content Intent.

If it is disabled, Discord may reject login with a disallowed intents error.

### Bot permissions

Recommended permissions:

- View Channels
- Send Messages
- Embed Links
- Read Message History
- Manage Roles
- Use Application Commands

`Manage Roles` is required for per-ticket roles.

The GitWatcher bot role must be above the `GW-xxxx` roles it creates.

Do not unnecessarily give the bot Administrator permission.

---

## 8. Local development setup — from scratch

### A. Clone

```bash
git clone https://github.com/Wordlly/GitWatcher.git
cd GitWatcher
```

### B. Install Node

Use Node.js 20 if possible.

Check:

```bash
node -v
npm -v
```

### C. Install packages

```bash
npm install
```

### D. Start PostgreSQL locally

Easy Docker option:

```bash
docker run --name gitwatcher-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=gitwatcher \
  -p 5432:5432 \
  -d postgres:16
```

Then:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gitwatcher
```

You can also connect the local bot to Railway PostgreSQL, but that means your local development instance is modifying production data. A local DB is safer.

### E. Add `.env`

Create `.env` in project root:

```env
DISCORD_TOKEN=...
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/gitwatcher
GITWATCHER_ENCRYPTION_KEY=...
PORT=3000
POLL_SECONDS=60
```

### F. Run

```bash
npm start
```

Expected startup logs are roughly:

```text
PostgreSQL ready.
Health/webhook server listening on 3000
Discord connected as GitWatcher#....
Global /gitwatcher command registered.
GitHub watcher started.
```

### G. Check health

```bash
curl http://localhost:3000/health
```

Expected:

```json
{"ok":true}
```

### H. Important local Discord warning

If local GitWatcher and Railway GitWatcher both run with the **same Discord token at the same time**, both instances may respond/poll simultaneously and create confusing behaviour.

For local testing, either:

- stop/disable Railway temporarily, or
- create a separate Discord test application/bot token for local development.

A separate test bot is the cleaner development setup.

---

## 9. Current Discord commands

### General

```text
/gitwatcher help
/gitwatcher status
```

### Security / management

```text
/gitwatcher micromanager role:@Role
/gitwatcher adminlog
```

`micromanager` can only be configured by a true Discord server Administrator.

`adminlog` can only be configured by a true Discord server Administrator and sets the current channel as the admin-log destination.

### GitHub authentication

```text
/gitwatcher auth
/gitwatcher auth-status
/gitwatcher auth-remove
```

`/auth` displays a private Discord modal. The token is validated against GitHub before saving.

Current private-repo solution: **classic GitHub PAT** with the `repo` scope because the team/private UoA repository could not be selected by a fine-grained PAT. This approach is currently confirmed to work.

### Developer identity

```text
/gitwatcher setuser github:Wordlly
/gitwatcher setuser github:https://github.com/Wordlly
/gitwatcher whoami
```

Mappings are scoped per Discord guild.

The database stores:

- Discord user ID
- GitHub stable numeric user ID
- GitHub login

This is used to attribute commits to ticket assignees.

### Repository watching

```text
/gitwatcher watch repository:https://github.com/owner/repo
/gitwatcher unwatch
/gitwatcher repos
```

Current ticket watcher tracks `main` only.

The design is one active ticket-watched repository per Discord channel.

Examples:

```text
#frontend → frontend repo
#backend  → backend repo
```

### Git activity logging

```text
/gitwatcher logs repository:https://github.com/owner/repo branch:development
/gitwatcher unlog repository:https://github.com/owner/repo branch:development
/gitwatcher log-list
```

This is separate from `/watch`.

`/watch` = ticket completion on `main`.

`/logs` = general activity logging for an arbitrary branch.

### Tickets

```text
/gitwatcher assign user:@Person description:Setup development notes
/gitwatcher ffa description:Create Django repo slots:2
/gitwatcher transfer ticket:GW-0003 user:@Person
```

### Paused webhook command

The code currently still contains:

```text
/gitwatcher webhook repository:<url>
```

but webhook development was explicitly paused after Discord command-registration trouble and because classic PAT polling works. Treat this as experimental/non-primary functionality. It is safe to remove later if desired.

---

## 10. Current permission model

### Discord Administrator only

- `/gitwatcher micromanager`
- `/gitwatcher adminlog`

### Manage Server OR configured Micromanager role

Current code allows these through `requireManager()`:

- `/gitwatcher auth`
- `/gitwatcher auth-remove`
- `/gitwatcher watch`
- `/gitwatcher unwatch`
- `/gitwatcher assign`
- `/gitwatcher ffa`

The Micromanager role is stored per guild.

### Manage Server / Administrator

The following currently still use the older `admin()` check rather than the Micromanager role:

- `/gitwatcher logs`
- `/gitwatcher unlog`
- `/gitwatcher transfer`
- experimental `/gitwatcher webhook`

### Anyone in server

- `/gitwatcher help`
- `/gitwatcher status`
- `/gitwatcher setuser`
- `/gitwatcher whoami`
- `/gitwatcher repos`
- `/gitwatcher log-list`

Ticket buttons themselves have separate assignment/role checks.

---

## 11. Ticket lifecycle

Normal manual ticket:

```text
OPEN
  ↓ assigned user accepts
IN_PROGRESS
  ↓ matching commit detected on main
COMPLETED
  ↓ accepted assignee signs off
CLOSED
```

Manual closure path:

```text
OPEN
  ↓ accept
IN_PROGRESS
  ↓ accepted assignee presses Close Manually
CLOSED
```

Manual closure displays:

```text
Manual: Ticket has been closed
```

instead of the normal closed status text.

---

## 12. Ticket numbering

Visible ticket numbering is per guild.

Example:

```text
Server A → GW-0001
Server B → GW-0001
```

The database still uses a global `BIGSERIAL` ticket primary key internally.

`guild_settings.next_ticket_number` controls visible numbering.

---

## 13. Ticket commit matching rules

Ticket title is normalized using:

```js
value.trim().replace(/\s+/g, ' ').toLowerCase()
```

The watcher compares this against the **first line of the Git commit message**.

These match:

```text
Setup development notes
setup development notes
SETUP DEVELOPMENT NOTES
Setup    development notes
```

This is **not fuzzy matching**.

These are not guaranteed to match:

```text
Finished setup development notes
Setup dev notes
```

Despite earlier discussion mentioning grammar/typo tolerance, the current implementation does **not** implement typo/fuzzy matching. It only ignores case and repeated/outer whitespace. This is an important current-state detail.

For automatic completion, all of these must be true:

1. commit is detected on the watched repository's `main`
2. normalized first commit-message line equals normalized ticket title
3. GitHub commit `author.id` is present
4. that stable GitHub ID maps to a Discord user in the same guild
5. that Discord user is an accepted ticket assignee
6. ticket is `IN_PROGRESS`

If multiple active matching tickets exist for the same repository/user/title, GitWatcher refuses to guess and posts a warning instead.

If GitHub returns no linked `commit.author` account, auto-completion is skipped.

---

## 14. Assigned ticket accept/decline workflow

For `/assign`, only the originally assigned Discord user can accept the ticket.

The ticket displays:

- Accept Ticket
- Decline
- Sign Off (disabled until completed)
- Close Manually (enabled only while appropriate)

If assigned user declines:

```text
@Person2 has declined the task @Person1, please select a new member to take on this task.
```

The rejection is:

- saved in PostgreSQL
- sent to configured admin log
- left in normal Discord channel history

GitWatcher creates a pending reassignment tied to:

- guild
- channel
- ticket
- original delegator

Only the **original delegator** can reassign using a normal Discord user mention in that same channel.

Example:

```text
Person 3: @Person6     ← ignored
Person 4: @Person8     ← ignored
Person 1: @Person5     ← accepted because Person 1 created/delegated ticket
```

GitWatcher then posts a new accept/decline prompt for Person 5.

This feature is why Message Content Intent is required.

---

## 15. FFA tickets

Example:

```text
/gitwatcher ffa description:Build API routes slots:2
```

Anyone may accept until capacity.

The ticket stays `OPEN` until the requested number of accepted users is reached.

Then it becomes `IN_PROGRESS`.

All accepted assignees share the same ticket role.

After automatic completion, every accepted assignee must sign off before the ticket becomes `CLOSED`.

FFA transfer is not implemented.

Manual close is intentionally only implemented for single-assignee, non-FFA tickets.

---

## 16. Ticket Discord roles

On acceptance, GitWatcher creates a role named after the ticket, for example:

```text
GW-0007
```

The role is created with:

```text
permissions: []
```

so it is only an identity/label, not a privileged role.

It is assigned to accepted assignees.

Ticket-role ownership is checked before protected ticket actions such as:

- Sign Off
- Close Manually

The role is deleted when:

- ticket closes normally after final sign-off
- ticket closes manually
- manual ticket is transferred

If Discord role assignment fails, ticket acceptance itself still succeeds and the bot warns about missing Manage Roles permissions.

---

## 17. Manual completion / admin audit logging

A single-assignee ticket in `IN_PROGRESS` can be manually closed by its accepted assignee if they also possess the ticket role.

The admin log receives:

```text
@Person5 Manually completed task GW-0008 "Setup database"
```

Rejections generate:

```text
@Person2 rejected task GW-0005 "Create login system"
```

Admin log destination is stored per guild via `/gitwatcher adminlog`.

Rejection events are additionally stored in the `ticket_rejections` database table.

Manual closure is recorded on the ticket using:

- `manual_closed`
- `manual_closed_by`
- `closed_at`

---

## 18. Branch commit logging

`/gitwatcher logs` creates a per-channel branch subscription.

When configured, GitWatcher stores the branch's current HEAD as `last_seen_sha`. This deliberately avoids dumping old commit history when logging is first enabled.

On later polling cycles:

1. get current branch HEAD
2. compare old SHA → new SHA
3. send each new commit to Discord
4. update checkpoint

Discord example:

```text
🔨 Wordlly pushed to development
[a81f92c] Setup development notes
```

If the branch no longer exists:

- subscription is deleted
- channel gets one message that logging stopped
- bot no longer polls that dead branch

If history was rewritten / force-pushed and compare fails:

- checkpoint is reset to current HEAD
- uncertain history is not replayed

Current compare endpoint asks for up to 100 commits. A gap larger than 100 commits between polls is a known scalability limitation.

---

## 19. New branch creation logging

For repositories involved in branch logging, GitWatcher also polls GitHub's repository Events API.

It looks for:

```text
CreateEvent + payload.ref_type === branch
```

and posts something like:

```text
🌿 Wordlly created branch `feature/login` in `owner/repo`.
```

GitHub event `actor.login` is used as the branch creator.

`repo_event_state` stores the last seen GitHub event ID per guild/channel/repository.

First run establishes a baseline instead of dumping old branch events.

If the checkpoint falls out of GitHub's bounded event feed, GitWatcher resets the checkpoint rather than replaying uncertain history.

Important: the repository Events API is not real-time and this is still polling-based, so branch creation notifications can be delayed.

---

## 20. GitHub credential model

### What is stored

The GitHub token **must currently be stored** because the bot needs to continue accessing private repositories across restarts without asking an admin to paste the token again.

Stored in PostgreSQL table:

```text
github_credentials
```

Fields include:

- `guild_id`
- encrypted token
- GitHub login
- GitHub numeric user ID
- Discord user who updated it
- update timestamp

The PAT is **not stored as plaintext**.

### Current encryption

Preferred encryption uses:

- key derived from `GITWATCHER_ENCRYPTION_KEY` using `scrypt`
- AES-256-GCM
- random 12-byte IV per encrypted value
- authenticated encryption tag

Stored format resembles:

```text
v2.<iv>.<tag>.<ciphertext>
```

### Legacy compatibility

Older versions encrypted PATs using a key derived from `DISCORD_TOKEN`.

The current code still supports decrypting those values.

When a dedicated `GITWATCHER_ENCRYPTION_KEY` is configured and an old token is read successfully, the token is automatically re-encrypted into the new `v2` format.

Do not remove/change the encryption key casually. Existing v2 encrypted tokens require the same key to be decrypted.

### Current PAT type

For the private UoA repository, a **classic PAT** with `repo` scope was confirmed to work.

Fine-grained PATs were attempted first but the repository did not appear as an available repository/resource due to GitHub ownership/organisation access constraints.

Long term, a GitHub App is the safer architecture because a classic `repo` PAT is broad.

---

## 21. GitHub URL / profile validation

The bot now validates GitHub URLs before making API calls.

Valid repository forms include:

```text
https://github.com/Wordlly/GitWatcher
https://github.com/Wordlly/GitWatcher/
https://github.com/Wordlly/GitWatcher.git
```

Rejected examples include:

```text
http://evil.example/github/Wordlly/GitWatcher
https://github.com/Wordlly/GitWatcher/issues/5
https://github.com/Wordlly/GitWatcher?x=y
https://user:pass@github.com/Wordlly/GitWatcher
```

Requirements:

- HTTPS
- hostname exactly `github.com` or `www.github.com`
- exactly owner/repo path
- no credentials
- no port
- no query string
- no fragment
- owner/repo validated against safe character patterns

GitHub profile parsing is also restricted to a normal username or single-path GitHub profile URL.

---

## 22. Multi-server isolation

This is built into the data model rather than handled through separate deployments.

Nearly every user-facing resource is scoped by `guild_id`.

Examples:

```text
Discord Server A
├── its PAT
├── its linked users
├── its repositories
├── its ticket numbers
├── its Micromanager role
├── its admin log
└── its tickets

Discord Server B
├── independent PAT
├── independent linked users
├── independent repos
├── independent GW-0001 numbering
└── independent settings
```

Key protections:

- GitHub credential primary key = guild ID
- GitHub identity uniqueness is within guild
- repositories contain guild ID
- ticket visible numbering unique on `(guild_id, ticket_number)`
- ticket button handlers fetch ticket then explicitly verify `ticket.guild_id === interaction.guildId`
- many mutating SQL queries include both internal ticket ID and guild ID
- Micromanager/admin log values are guild-scoped

This is the intended multi-tenant architecture for a single bot deployment.

### Important future hardening

For a public SaaS-level release, do a dedicated audit of every SQL query to guarantee every cross-guild operation is explicitly scoped. The current structure is good for the MVP, but this should be systematically tested rather than assumed.

---

## 23. Database schema summary

### `guild_settings`

- `guild_id` PK
- `next_ticket_number`
- `micromanager_role_id`
- `admin_log_channel_id`
- created timestamp

### `github_credentials`

One credential per guild.

- encrypted token
- GitHub account metadata
- updater

### `github_users`

Discord ↔ GitHub mapping per guild.

Unique constraints:

- `(guild_id, discord_user_id)` primary key
- `(guild_id, github_user_id)` unique

### `repositories`

- internal ID
- guild
- channel
- owner/repo
- branch (currently main for ticket watcher)
- private flag
- last seen SHA
- active flag
- `webhook_only` leftover/experimental field
- creator/time

A partial unique index enforces one active watched repository per guild/channel.

### `branch_logs`

Per-channel arbitrary-branch commit logging subscription.

### `repo_event_state`

Stores branch-creation event checkpoint.

### `tickets`

Contains:

- global internal ID
- guild-visible ticket number
- repository relation
- channel/message
- title + normalized title
- status
- max assignees
- FFA flag
- creator
- completion commit metadata
- ticket role ID
- manual-close metadata
- timestamps

### `ticket_assignees`

- ticket
- Discord user
- accepted
- signed off
- timestamps

### `ticket_rejections`

Historical record of assignment rejections.

### `pending_reassignments`

Temporary record allowing only original delegator to select a replacement user after a rejection.

### `webhook_endpoints`

Left from paused webhook experiment.

---

## 24. GitHub polling design

Default interval:

```text
300 seconds / 5 minutes
```

Minimum:

```text
60 seconds
```

Each watcher cycle currently does three categories of work:

1. ticket-watched `main` repositories
2. branch log subscriptions
3. GitHub repository events for branch creation

### Ticket watcher

Uses:

- Get branch `main`
- Compare old SHA ... new SHA

This is better than simply fetching the latest N commits because it can process commits accumulated while GitWatcher was offline.

### Branch log watcher

Uses:

- Get specific branch
- Compare previous SHA ... current SHA

### Branch creation watcher

Uses GitHub repository Events API and checkpoint event IDs.

---

## 25. Current security decisions

Already implemented:

- PAT encrypted at rest
- dedicated encryption secret supported
- AES-256-GCM authenticated encryption
- random IV per secret
- legacy secret migration
- admin-only security config
- Micromanager delegation role
- ticket role verification for sign-off/manual close
- assigned user-only accept/decline
- guild checks in ticket interactions
- GitHub URL validation
- parameterized PostgreSQL queries
- ticket roles created with zero permissions
- secrets are not intentionally printed in normal logs

Still recommended before any public launch:

- replace classic PATs with GitHub App authentication
- full multi-tenant query audit
- structured audit logs for more admin actions
- rate limiting / abuse controls
- explicit database backups
- token rotation procedure
- secrets manager rather than only Railway variables
- automated security tests
- command permission integration at Discord registration level in addition to runtime checks

---

## 26. Railway deployment

Current Dockerfile:

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
ENV NODE_ENV=production
CMD ["npm", "start"]
```

`railway.json` uses Dockerfile builder and health check `/health`.

Minimum Railway variables:

```text
DISCORD_TOKEN
DATABASE_URL or POSTGRES_URL
GITWATCHER_ENCRYPTION_KEY   # strongly recommended
```

Railway itself supplies `PORT`.

No per-server values belong in Railway.

Do **not** add things like:

```text
DISCORD_GUILD_ID
WATCHED_REPO
WATCHED_BRANCH
GITHUB_TOKEN
LOG_CHANNEL_ID
```

Those belong in Discord/PostgreSQL configuration.

---

## 27. Key product design principle

Keep this architecture intact unless there is a strong reason to change it:

> Railway runs GitWatcher. Discord configures GitWatcher. PostgreSQL remembers GitWatcher. GitHub is watched by GitWatcher. Source code does not change when a new server/repository is added.

That means:

- one bot deployment
- many Discord guilds
- no redeploy when a guild changes repository
- no per-guild environment variables
- commands are the product configuration interface

---

## 28. Known issues / caveats

### 1. Webhook experiment is paused

Webhook work was attempted because fine-grained PAT access to the private university repository was awkward.

A public Railway route and `/gitwatcher webhook` code were added, but Discord slash command propagation/registration caused confusion and the work was paused.

Then a classic PAT was tested and **worked**, so polling is the current preferred approach.

Current source may still contain:

- webhook command definition
- webhook route
- webhook database tables/fields
- webhook service

Treat it as experimental/dead code unless development resumes.

### 2. Global slash commands

Current code runs:

```js
await client.application.commands.set([gitwatcherCommand]);
```

on ready.

This registers the command globally.

During webhook development, Discord appeared to show an old command definition even after Railway deployment. If slash command changes seem missing:

- verify source was pushed
- verify Railway/local runtime is running latest commit
- inspect startup registration logs
- consider clearing stale guild-specific command definitions if any exist
- allow time for global command/client cache refresh

For faster local development, a future dev-mode feature could register commands to a dedicated test guild instead of globally.

### 3. No fuzzy commit matching

Current matching does not ignore grammar or typos despite earlier UX discussion. Only case/whitespace normalization exists.

### 4. GitHub API rate limits

Polling every repo, branch log, and event feed can eventually become expensive as usage grows.

Fine for current small-team MVP, but at scale move to GitHub App/webhooks or smarter shared polling.

### 5. Compare limit

Compare calls request `per_page=100`. More than 100 unseen commits could be missed without pagination.

### 6. GitHub Events API delays

Branch creation logging can be delayed because GitHub's Events API is not real-time.

### 7. Classic PAT scope

Current classic PAT uses broad `repo` permission. Works for MVP but is not ideal for a public product.

### 8. Role hierarchy

If GitWatcher cannot create/assign/remove ticket roles, check:

- Manage Roles permission
- GitWatcher bot role position

### 9. Manual reassignment consumes normal messages

After a rejection, the original delegator's next valid user mention in the same channel selects a replacement for their oldest pending rejected ticket. This is convenient but could surprise someone if they mention a user for unrelated reasons before reassigning.

A dedicated `/reassign` command or Select Menu would be cleaner later.

---

## 29. Confirmed working / completed functionality

The project has already implemented the following major features:

- Node.js/Discord.js rewrite inspired by TitanBot architecture
- Railway deployment
- PostgreSQL persistence
- global `/gitwatcher` command
- per-guild configuration
- public repo watching
- private repo access through classic PAT
- encrypted PAT storage
- GitHub identity linking
- stable GitHub numeric ID commit attribution
- per-channel watched repository
- per-guild ticket numbering
- manual tickets
- FFA tickets
- ticket acceptance
- ticket decline/reassignment flow
- ticket transfer
- ticket roles
- ticket-role-protected signoff
- manual closure
- admin event logs
- Micromanager delegated controls
- exact normalized commit/title matching
- automatic completion from `main`
- ambiguity protection when multiple tickets match
- arbitrary branch commit logging
- automatic branch-log removal when branch deleted
- branch creation notifications
- repository/profile URL validation
- multi-guild data isolation foundations
- health endpoint
- Docker/Railway configuration

---

## 30. Suggested next development priorities

### High value: Pull request tracking

Recommended next major GitHub feature:

- PR opened
- PR merged
- PR closed without merge
- review requested
- review approved
- changes requested

Potential later link:

```text
Ticket → branch → commits → pull request → review → merge → close
```

### High value: CI / workflow notifications

Notify for:

- failed test/workflow
- successful recovery after failure
- deployment failure

### Useful: direct push to main alert

Especially if project expects PR-based workflow.

### Useful: dashboard

Potential command:

```text
/gitwatcher dashboard
```

showing:

- open tickets
- in-progress tickets
- completed tickets
- active assignees
- open PRs
- blocked/failed CI

### Technical debt priorities

1. remove or finish webhook experiment
2. add GitHub compare pagination
3. dev-guild slash-command registration mode
4. automated tests for ticket state transitions
5. automated database isolation tests
6. GitHub App migration
7. better structured logging

---

## 31. Local testing checklist

Before changing code, verify baseline locally.

### Startup

- [ ] PostgreSQL starts
- [ ] migrations succeed
- [ ] Discord logs in
- [ ] global/test-guild command registers
- [ ] `/health` responds
- [ ] watcher starts

### Identity/auth

- [ ] `/setuser` links account
- [ ] `/whoami` returns it
- [ ] `/auth` accepts classic PAT
- [ ] `/auth-status` shows connected account
- [ ] encrypted DB value is not plaintext token

### Repo

- [ ] `/watch` connects public repo
- [ ] `/watch` connects private repo using PAT
- [ ] `/repos` lists correct guild/channel
- [ ] `/unwatch` deactivates channel mapping without deleting history

### Tickets

- [ ] assign ticket
- [ ] only assigned user can accept
- [ ] assigned user can decline
- [ ] rejection appears in channel
- [ ] rejection appears in admin log
- [ ] only original delegator mention triggers reassignment
- [ ] replacement user can accept
- [ ] acceptance creates ticket role
- [ ] commit matching completes ticket
- [ ] only role-holding accepted assignee can sign off
- [ ] final close removes role
- [ ] manual close records manual status/admin log

### FFA

- [ ] multiple users can accept up to limit
- [ ] status remains OPEN until slots full
- [ ] shared role is assigned to all accepted users
- [ ] matching accepted user can complete ticket
- [ ] all accepted users sign off before CLOSED

### Logs

- [ ] `/logs` starts from current HEAD without old spam
- [ ] new commit posts
- [ ] new branch event posts
- [ ] deleted branch auto-unlogs
- [ ] `/unlog` removes exact channel/repo/branch subscription

### Multi-server

Use two test guilds if possible:

- [ ] separate PATs
- [ ] separate ticket numbering
- [ ] separate user mappings
- [ ] separate repos
- [ ] ticket button from guild A cannot affect ticket in guild B
- [ ] Micromanager/admin log settings stay isolated

---

## 32. Production/testing advice when moving local

For safest handoff, create:

1. a separate Discord **GitWatcher Dev** bot/application
2. a local PostgreSQL database
3. a `.env` containing dev credentials
4. one test Discord server
5. one test GitHub repo

Do not develop directly against production credentials/data unless necessary.

Recommended local branch:

```bash
git checkout -b dev/local-handover
```

Then use normal Git workflow to push changes back to the public GitWatcher repo when stable.

---

## 33. Secrets that must never be committed

Never commit:

- Discord bot token
- classic GitHub PAT
- Railway/Postgres connection string containing credentials
- `GITWATCHER_ENCRYPTION_KEY`
- generated webhook secrets

Recommended `.gitignore` entries:

```gitignore
.env
.env.*
node_modules/
.DS_Store
```

If any secret is accidentally committed, rotate it immediately; deleting it from the newest commit alone is not enough because Git history can retain it.

---

## 34. Important state assumptions for continuing development

These points reflect the latest project decisions:

- Classic PAT polling is the **current working private repo solution**.
- Webhooks are **paused**, not the active architecture.
- `main` is the ticket-completion branch.
- `/logs` may track arbitrary branches.
- branch creation should generate Discord notifications.
- developers should not need GitWatcher-specific Git commands.
- ticket IDs are not required in commit messages.
- exact normalized ticket title matching is preferred over risky fuzzy matching.
- wrong automatic completion is considered worse than a missed automatic completion.
- one deployment must serve multiple Discord servers.
- Discord commands should remain the main user configuration surface.
- PostgreSQL should remain the source of truth for bot state.
- README should stay simple; richer usage can live in `/gitwatcher help` or separate developer docs.

---

## 35. Short architecture diagram

```text
                         Discord
                            │
            slash commands │ buttons/messages
                            ▼
                    ┌──────────────┐
                    │  GitWatcher  │
                    │ Node.js v20  │
                    │ Discord.js   │
                    └──────┬───────┘
                           │
             ┌─────────────┼──────────────┐
             │             │              │
             ▼             ▼              ▼
       PostgreSQL      GitHub REST      Express
       persistent      polling/API      /health
       state            private PAT     paused webhook
             │
             └── guild-isolated data
```

---

## 36. Handover bottom line

To continue development locally, the minimum is:

1. clone `https://github.com/Wordlly/GitWatcher`
2. install Node 20
3. `npm install`
4. start PostgreSQL
5. create `.env` with Discord token, DB URL, and encryption key
6. enable Message Content Intent for the bot
7. ensure bot has Manage Roles in the test server
8. stop the production bot or preferably use a separate dev Discord bot
9. `npm start`
10. verify `/gitwatcher help`, `/setuser`, `/auth`, `/watch`, and a test ticket

The core architecture is already functional. The current working path is Discord + PostgreSQL + GitHub REST polling using a classic PAT for private repositories. The biggest unfinished/experimental area is the webhook path, which is not required for the current bot to function.
