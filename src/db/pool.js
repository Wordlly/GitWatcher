import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 5,
  ssl: config.databaseUrl.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

pool.on('error', (error) => {
  console.error('PostgreSQL pool error:', error.message);
});
