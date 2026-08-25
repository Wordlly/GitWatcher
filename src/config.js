import 'dotenv/config';

function first(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return '';
}

export const config = {
  discordToken: first('DISCORD_TOKEN', 'BOT_TOKEN'),
  databaseUrl: first('POSTGRES_URL', 'DATABASE_URL'),
  port: Number(process.env.PORT || 3000),
  pollSeconds: Math.max(Number(process.env.POLL_SECONDS || 300), 60),
};

if (!config.discordToken || !config.databaseUrl) {
  console.error(
    'GitWatcher needs DISCORD_TOKEN and POSTGRES_URL (or DATABASE_URL) in Railway.'
  );
  process.exit(1);
}
