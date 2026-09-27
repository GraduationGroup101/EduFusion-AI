const { Pool } = require('pg');
let instance;

const enabled = () => process.env.LECTURE_STUDY_ENABLED === 'true';
const unavailable = () => Object.assign(new Error('Lecture study is not configured'), { statusCode: 503 });
const getPool = () => {
  if (!enabled() || !process.env.LEARNING_DATABASE_URL) throw unavailable();
  if (!instance) {
    const url = new URL(process.env.LEARNING_DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)||url.pathname.length<2) throw unavailable();
    const academic=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
    if(academic&&academic.hostname===url.hostname&&(academic.port||'5432')===(url.port||'5432')&&academic.pathname===url.pathname)throw unavailable();
    if(process.env.LEARNING_DB_SSL==='false'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw unavailable();
    const maxMb=Number(process.env.LECTURE_STUDY_MAX_DB_MB||500);
    if(!Number.isFinite(maxMb)||maxMb<50||maxMb>5000)throw unavailable();
    for (const flag of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert']) url.searchParams.delete(flag);
    instance = new Pool({
      connectionString: url.href, max: 5, connectionTimeoutMillis: 10000, idleTimeoutMillis: 30000,
      ssl: process.env.LEARNING_DB_SSL === 'false' ? false : {
        rejectUnauthorized: true,
        ...(process.env.LEARNING_DB_SSL_CA ? { ca: process.env.LEARNING_DB_SSL_CA.replace(/\\n/g, '\n') } : {}),
      },
    });
    instance.on('error', (error) => console.error('Learning database connection failed:', error.code || error.name));
  }
  return instance;
};
const query = (sql, params) => getPool().query(sql, params);
const transaction = async (work) => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* Preserve the failure. */ }
    throw error;
  } finally { client.release(); }
};
const close = async () => { if (instance) { await instance.end(); instance = undefined; } };
module.exports = { enabled, query, transaction, close };
