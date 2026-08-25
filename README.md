# GitWatcher

GitWatcher watches GitHub and helps track tasks in Discord.

## Setup

### 1. Put this project on GitHub

Upload all these files to your GitHub repo.

Do **not** upload your real `.env` file.

### 2. Make a Railway project

In Railway:

1. Create a new project
2. Pick **Deploy from GitHub repo**
3. Select your GitWatcher repo
4. Add **PostgreSQL**

### 3. Add these Railway variables

```text
DISCORD_TOKEN=your_discord_bot_token
DISCORD_GUILD_ID=your_discord_server_id
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

For private GitHub repos, also add:

```text
GITHUB_TOKEN=your_github_token
```

### 4. Invite the bot to Discord

Give it permission to:

```text
View Channels
Send Messages
Embed Links
Read Message History
Use Application Commands
```

### 5. Use the bot

In Discord, type:

```text
/gitwatcher help
```

That tells you how to use everything.

Example:

```text
/gitwatcher watch https://github.com/owner/repo
```

Then:

```text
/gitwatcher assign @john "Setup development notes"
```

## Done

If the bot is online in Discord, you are ready.

Use:

```text
/gitwatcher help
```

for everything else.
