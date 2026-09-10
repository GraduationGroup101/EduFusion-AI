const { Pool } = require('pg');
require('dotenv').config();

const TRANSIENT_CONNECTION_CODES = new Set([
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
  '57P01', '57P02', '57P03',
  'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT',
]);
const QUERY_RETRIES = Math.max(0, Number(process.env.DB_QUERY_RETRIES || 2));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 30000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

const isTransientConnectionError = (error) => {
  if (TRANSIENT_CONNECTION_CODES.has(error?.code)) return true;
  return /connection terminated|connection closed|socket hang up|timeout/i.test(error?.message || '');
};

const query = async (text, params) => {
  for (let attempt = 0; attempt <= QUERY_RETRIES; attempt += 1) {
    const start = Date.now();

    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      console.log('Executed query', { text: text.substring(0, 80), duration, rows: res.rowCount });
      return res;
    } catch (error) {
      if (!isTransientConnectionError(error) || attempt === QUERY_RETRIES) {
        throw error;
      }

      const delayMs = 250 * (attempt + 1);
      console.warn('Transient database connection error; retrying query', {
        code: error.code || 'CONNECTION_ERROR',
        attempt: attempt + 1,
        delayMs,
      });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw new Error('Database query retry loop ended unexpectedly');
};

module.exports = { pool, query, isTransientConnectionError };
