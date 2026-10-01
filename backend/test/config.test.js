const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment, environmentWarnings } = require('../src/config');
test('startup rejects example secrets and invalid transport settings', () => {
  const env = { DATABASE_URL: 'postgresql://localhost/edufusion', JWT_SECRET: 'a-valid-random-secret-for-testing-only' };
  assert.doesNotThrow(() => validateEnvironment(env));
  for (const JWT_SECRET of ['secret', 'replace-with-a-random-secret-at-least-32-characters']) {
    assert.throws(() => validateEnvironment({ ...env, JWT_SECRET }), /JWT_SECRET/);
  }
  assert.throws(() => validateEnvironment({ ...env, DB_SSL: 'disabled' }), /DB_SSL/);
  assert.throws(() => validateEnvironment({ ...env, DATABASE_URL: 'https://example.test' }), /DATABASE_URL/);
});

test('hosted deployments without the LectureScribe gateway key are warned that unwatched lectures can be lost', () => {
  for (const host of [{ VERCEL: '1' }, { RENDER: 'true' }]) {
    assert.match(environmentWarnings(host).join(), /LECTURESCRIBE_GATEWAY_KEY.*callbacks/);
    assert.deepEqual(environmentWarnings({ ...host, LECTURESCRIBE_GATEWAY_KEY: 'key' }), []);
    assert.match(environmentWarnings({ ...host, LECTURESCRIBE_GATEWAY_KEY: '  ' }).join(), /LECTURESCRIBE_GATEWAY_KEY/);
  }
  assert.deepEqual(environmentWarnings({}), []);
});
