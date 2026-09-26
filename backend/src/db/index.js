const { Pool } = require('pg');
require('dotenv').config();

const TRANSIENT_CONNECTION_CODES = new Set([
  '08000', '08001', '08003', '08004', '08006', '08007', '08P01',
  '57P01', '57P02', '57P03',
  'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'ETIMEDOUT',
]);
const QUERY_RETRIES = Math.min(5, Math.max(0, Number.parseInt(process.env.DB_QUERY_RETRIES || '2', 10) || 0));

const connectionUrl = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
// pg's connection-string SSL flags override the ssl object. Keep verification
// policy explicit so sslmode=require cannot silently disable certificate checks.
for (const key of ['sslmode','sslcert','sslkey','sslrootcert']) connectionUrl?.searchParams.delete(key);
const pool = new Pool({
  connectionString: connectionUrl?.href,
  ssl: process.env.DB_SSL === 'false' ? false : {
    rejectUnauthorized: true,
    ...(process.env.DB_SSL_CA ? { ca: process.env.DB_SSL_CA.replace(/\\n/g, '\n') } : {}),
  },
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

// A lost acknowledgement can follow a committed write. Retry only reads whose
// caller explicitly declares them safe, never an arbitrary SQL statement.
const query = async (text, params, { retrySafe = false } = {}) => {
  const retries = retrySafe ? QUERY_RETRIES : 0;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const start = Date.now();

    try {
      const res = await pool.query(text, params);
      const duration = Date.now() - start;
      if (process.env.DB_LOG_QUERIES === 'true') console.log('Executed query', { text: text.substring(0, 80), duration, rows: res.rowCount });
      return res;
    } catch (error) {
      if (!isTransientConnectionError(error) || attempt === retries) {
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

const readQuery = (text, params) => query(text, params, { retrySafe: true });

const transaction = async (work) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the original error. */ }
    throw error;
  } finally {
    client.release();
  }
};

module.exports = { pool, query, readQuery, transaction, isTransientConnectionError };
