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
  encryptionKey: first('GITWATCHER_ENCRYPTION_KEY'),
  port: Number(process.env.PORT || 3000),
  pollSeconds: Math.max(Number(process.env.POLL_SECONDS || 300), 60),
};

if (!config.discordToken || !config.databaseUrl) {
  console.error(
    'GitWatcher needs DISCORD_TOKEN and POSTGRES_URL (or DATABASE_URL) in Railway.'
  );
  process.exit(1);
}

if (!config.encryptionKey) {
  console.warn(
    'Security warning: GITWATCHER_ENCRYPTION_KEY is not set. ' +
    'Existing functionality will continue using the legacy Discord-token-derived key, ' +
    'but add a dedicated encryption key in Railway to secure stored GitHub credentials.'
  );
}
