# GitWatcher

## Railway setup

GitWatcher only needs **3 variables** in Railway:

```text
DISCORD_TOKEN=your Discord bot token
DATABASE_URL=${{Postgres.DATABASE_URL}}
GITWATCHER_ENCRYPTION_KEY=any long random secret
```

Then deploy.

If the bot comes online, use:

```text
/gitwatcher help
```

Everything else is managed from Discord.

## Private GitHub repo

Admin:

```text
/gitwatcher auth
```

Paste a GitHub token in the private popup.

Then, in the Discord channel you want linked to that repo:

```text
/gitwatcher watch https://github.com/owner/repo
```

Done.
