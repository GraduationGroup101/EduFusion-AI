const fs = require('node:fs/promises');
const path = require('node:path');
const { pool, transaction } = require('../src/db');

const migrate = async () => {
  const directory = path.join(__dirname, '../migrations');
  const files = (await fs.readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort();
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(20260926)');
    await client.query('CREATE TABLE IF NOT EXISTS edufusion_schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    for (const file of files) {
      const applied = await client.query('SELECT 1 FROM edufusion_schema_migrations WHERE name=$1', [file]);
      if (applied.rowCount) continue;
      await client.query(await fs.readFile(path.join(directory, file), 'utf8'));
      await client.query('INSERT INTO edufusion_schema_migrations(name) VALUES($1)', [file]);
      console.log(`Applied ${file}`);
    }
  });
};

if (require.main === module) migrate().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
module.exports = { migrate };
