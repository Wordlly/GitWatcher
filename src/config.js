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
  databaseUrl: first('DATABASE_URL', 'POSTGRES_URL'),
  encryptionKey: first('GITWATCHER_ENCRYPTION_KEY'),
  port: Number(process.env.PORT || 3000),
  pollSeconds: Math.max(Number(process.env.POLL_SECONDS || 300), 60),
};

const missing = [];
if (!config.discordToken) missing.push('DISCORD_TOKEN');
if (!config.databaseUrl) missing.push('DATABASE_URL');
if (!config.encryptionKey) missing.push('GITWATCHER_ENCRYPTION_KEY');

if (missing.length) {
  console.error('');
  console.error('GitWatcher cannot start yet.');
  console.error(`Missing Railway variable(s): ${missing.join(', ')}`);
  console.error('');
  console.error('Required Railway variables:');
  console.error('  DISCORD_TOKEN=...');
  console.error('  DATABASE_URL=${{Postgres.DATABASE_URL}}');
  console.error('  GITWATCHER_ENCRYPTION_KEY=<long random secret>');
  console.error('');
  process.exit(1);
}
