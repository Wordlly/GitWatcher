# GitWatcher

GitWatcher tracks GitHub tasks from Discord.

## Put it online

1. Put this project on GitHub.
2. Create a Railway project from that repo.
3. Add PostgreSQL.
4. Add these Railway variables:

```text
DISCORD_TOKEN=your_bot_token
DATABASE_URL=${{Postgres.DATABASE_URL}}
GITWATCHER_ENCRYPTION_KEY=any_long_random_secret
```

5. Start the bot.
6. In Discord, type:

```text
/gitwatcher help
```

Everything else is managed from Discord.
