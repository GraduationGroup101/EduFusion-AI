const assert = require('node:assert/strict');
const { before, after, test } = require('node:test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const bcrypt = require('bcryptjs');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-auth-migration-test-secret-32-chars';
const { pool } = require('../src/db');
const { migrate } = require('../scripts/migrate');
const { logAccountError } = require('../src/lib/accountError');
const app = require('../src/app');
let database;
const originalQuery = pool.query;
const originalConnect = pool.connect;
const logs = [];
const originalError = console.error;
const login = (username, password) => request(app).post('/api/auth/login').send({ username, password });

before(async () => {
  database = new PGlite();
  // Existing academic database, before any EduFusion migration ledger or PIN format.
  await database.exec(await fs.readFile(path.join(__dirname, '../migrations/001_core.sql'), 'utf8'));
  await database.query('INSERT INTO app_users(username,password_hash,role) VALUES($1,$2,$3)',
    ['migration-admin', await bcrypt.hash('admin-test-password', 4), 'admin']);
  await database.query('INSERT INTO students(id_student,student_name,pin_hash) VALUES(101,$1,$2)',
    ['Migration student', 'student-test-pin']);
  pool.query = async (sql, params) => {
    const result = !params?.length && sql.split(';').length > 2
      ? (await database.exec(sql)).at(-1) : await database.query(sql, params);
    return { rows: result.rows || [], rowCount: result.affectedRows || result.rows?.length || 0 };
  };
  pool.connect = async () => ({ query: pool.query, release() {} });
  console.error = (...args) => logs.push(args);
});

after(async () => {
  console.error = originalError;
  pool.query = originalQuery;
  pool.connect = originalConnect;
  await database.close();
  await pool.end();
});

test('unmigrated database reproduces student 503 while admin succeeds; migrations repair it', async () => {
  const failedStudent = await login('101', 'student-test-pin');
  assert.equal(failedStudent.status, 503);
  assert.deepEqual(failedStudent.body, { error: 'Account service is temporarily unavailable' });
  assert.equal(logs.at(-1)[1].code, '42703');
  assert.equal(logs.at(-1)[1].stage, 'student_account_lookup');
  assert.match(logs.at(-1)[1].message, /pin_format/);
  assert.equal((await login('migration-admin', 'admin-test-password')).status, 200);
  assert.equal((await request(app).get('/api/ready')).status, 503);

  await migrate();
  await migrate();
  assert.equal((await request(app).get('/api/ready')).status, 200);
  assert.equal((await database.query('SELECT count(*)::int AS count FROM edufusion_schema_migrations')).rows[0].count, 10);
  assert.equal((await database.query('SELECT pin_hash FROM students WHERE id_student=101')).rows[0].pin_hash, 'student-test-pin');

  assert.equal((await login('101', 'wrong-password')).status, 401);
  assert.equal((await login('999999', 'nonexistent-student')).status, 401);
  for (const [username, password, role] of [
    ['101', 'student-test-pin', 'student'],
    ['migration-admin', 'admin-test-password', 'admin'],
  ]) {
    const response = await login(username, password);
    assert.equal(response.status, 200);
    assert.equal(response.body.user.role, role);
    const auth = `Bearer ${response.body.token}`;
    // Repeated /me models restoring the same session after navigation/refresh.
    for (let attempt = 0; attempt < 2; attempt++) {
      const me = await request(app).get('/api/auth/me').set('Authorization', auth);
      assert.equal(me.status, 200);
      assert.equal(me.body.user.role, role);
    }
    const dashboard = role === 'student' ? '/api/dashboard/student-summary' : '/api/dashboard/stats';
    assert.equal((await request(app).get(dashboard).set('Authorization', auth)).status, 200);
    assert.equal((await request(app).get('/api/admin/clock').set('Authorization', auth)).status, role === 'student' ? 403 : 200);
    assert.equal((await request(app).post('/api/auth/logout').set('Authorization', auth)).status, 200);
    assert.equal((await request(app).get(dashboard)).status, 401);
  }
  const student = (await database.query('SELECT pin_hash,pin_format FROM students WHERE id_student=101')).rows[0];
  assert.equal(student.pin_format, 'bcrypt');
  assert.equal(await bcrypt.compare('student-test-pin', student.pin_hash), true);
  assert.equal((await login('101', 'student-test-pin')).status, 200);
  assert.equal((await login('migration-admin', 'wrong-password')).status, 401);
  assert.doesNotMatch(JSON.stringify(logs), /student-test-pin|admin-test-password/);
});

test('readiness rejects an incomplete ledger and a missing student column', async () => {
  await database.exec('BEGIN');
  try {
    await database.query("DELETE FROM edufusion_schema_migrations WHERE name='004_pin_format.sql'");
    assert.equal((await request(app).get('/api/ready')).status, 503);
    assert.equal(logs.at(-1)[1].code, 'MIGRATIONS_PENDING');
    assert.match(logs.at(-1)[1].message, /004_pin_format.sql/);
  } finally { await database.exec('ROLLBACK'); }
  await database.exec('BEGIN');
  try {
    await database.exec('ALTER TABLE students DROP COLUMN pin_format');
    assert.equal((await request(app).get('/api/ready')).status, 503);
    assert.equal(logs.at(-1)[1].code, '42703');
  } finally { await database.exec('ROLLBACK'); }
  assert.equal((await request(app).get('/api/ready')).status, 200);
});

test('account diagnostics omit row details and arbitrary exception messages', () => {
  logAccountError('student_pin_verification', Object.assign(new Error('private-password'), {
    code: '23514', detail: 'sensitive row contents', query: 'private SQL',
  }));
  assert.equal(logs.at(-1)[1].code, '23514');
  assert.doesNotMatch(JSON.stringify(logs.at(-1)), /private-password|sensitive row|private SQL/);
});
