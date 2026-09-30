const fs = require('node:fs');
const path = require('node:path');
const { readQuery } = require('./index');

const requiredMigrations = fs.readdirSync(path.join(__dirname, '../../migrations'))
  .filter((file) => /^\d+.*\.sql$/.test(file));

const assertDatabaseReady = async () => {
  const applied = await readQuery('SELECT name FROM edufusion_schema_migrations');
  const names = new Set(applied.rows.map((row) => row.name));
  const missing = requiredMigrations.filter((name) => !names.has(name));
  if (missing.length) {
    throw Object.assign(new Error(`Missing migrations: ${missing.join(', ')}`), { code: 'MIGRATIONS_PENDING' });
  }
  // Check the live student schema too: a ledger alone cannot detect drift.
  await readQuery('SELECT id_student, student_name, pin_hash, pin_format, created_at FROM students LIMIT 0');
  await readQuery('SELECT 1 FROM edufusion_clock_commands LIMIT 1');
  await readQuery('SELECT lease_client_id FROM edufusion_oral_exam_sessions LIMIT 0');
};

module.exports = { assertDatabaseReady };
