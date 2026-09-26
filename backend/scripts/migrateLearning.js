const fs = require('node:fs/promises');
const path = require('node:path');
const db = require('../src/lectureStudy/database');
const migrate = async () => {
  const directory = path.join(__dirname, '../learning-migrations');
  return db.transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(2026092601)');
    await client.query('CREATE TABLE IF NOT EXISTS study_schema_migrations(name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())');
    for (const file of (await fs.readdir(directory)).filter((file) => /^\d+.*\.sql$/.test(file)).sort()) {
      if ((await client.query('SELECT 1 FROM study_schema_migrations WHERE name=$1', [file])).rowCount) continue;
      await client.query(await fs.readFile(path.join(directory, file), 'utf8'));
      await client.query('INSERT INTO study_schema_migrations(name) VALUES($1)', [file]);
      console.log('Applied learning migration:', file);
    }
  });
};
if (require.main === module) migrate().catch((error) => {
  console.error('Learning migration failed:', error.code || error.name); process.exitCode = 1;
}).finally(db.close);
module.exports = { migrate };
