# GitWatcher

## Railway

You only need **2 variables** in the GitWatcher service:

```text
DISCORD_TOKEN=your Discord bot token
POSTGRES_URL=${{Postgres.DATABASE_URL}}
```

`DATABASE_URL` also works if you prefer that name.

Then deploy.

When the bot is online, type:

```text
/gitwatcher help
```

Everything else is done through Discord.
