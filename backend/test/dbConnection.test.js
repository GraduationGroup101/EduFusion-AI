const assert = require('node:assert/strict');
const { test } = require('node:test');

const { isTransientConnectionError, pool, query } = require('../src/db');

test('classifies connection failures without retrying ordinary SQL errors', () => {
  assert.equal(isTransientConnectionError({ code: 'ECONNRESET' }), true);
  assert.equal(isTransientConnectionError({ message: 'Connection terminated unexpectedly' }), true);
  assert.equal(isTransientConnectionError({ code: '23505', message: 'duplicate key' }), false);
});

test('retries a transient database disconnect and returns the next result', async () => {
  const originalQuery = pool.query;
  let attempts = 0;

  pool.query = async () => {
    attempts += 1;
    if (attempts < 3) {
      const error = new Error('Connection terminated unexpectedly');
      error.code = 'ECONNRESET';
      throw error;
    }
    return { rowCount: 1, rows: [{ value: 1 }] };
  };

  try {
    const result = await query('SELECT 1 AS value', [], { retrySafe: true });
    assert.equal(attempts, 3);
    assert.deepEqual(result.rows, [{ value: 1 }]);
  } finally {
    pool.query = originalQuery;
  }
});

test('does not repeat a write when its acknowledgement is lost', async () => {
  const original = pool.query;
  let writes = 0;
  pool.query = async () => { writes += 1; throw Object.assign(new Error('Lost acknowledgement'), { code: 'ECONNRESET' }); };
  try {
    await assert.rejects(query('INSERT INTO events VALUES ($1)', [1]), { code: 'ECONNRESET' });
    assert.equal(writes, 1);
  } finally { pool.query = original; }
});
