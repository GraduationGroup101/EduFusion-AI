const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const request = require('supertest');
const { createCorsOptions, getAllowedOrigins } = require('../src/lib/corsOrigins');
const production = 'https://frontend.example.test';
const preview = 'https://frontend-git-fix.example.test';
const app = express();
app.use(cors(createCorsOptions({ FRONTEND_URL: production, FRONTEND_URLS: ` ${preview}/, ${production} ` })));
app.get('/api/auth/registration-courses', (req, res) => res.json({ courses: [] }));
app.post('/api/auth/login', (req, res) => res.status(401).json({ error: 'Invalid credentials' }));

test('configured production and exact preview origins can read courses and login responses', async () => {
  for (const origin of [production, preview, 'http://localhost:3000']) {
    const courses = await request(app).get('/api/auth/registration-courses').set('Origin', origin);
    assert.equal(courses.status, 200);
    assert.equal(courses.headers['access-control-allow-origin'], origin);
    const preflight = await request(app).options('/api/auth/login').set('Origin', origin)
      .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'content-type,authorization');
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers['access-control-allow-origin'], origin);
    assert.equal(preflight.headers['access-control-allow-credentials'], 'true');
    assert.match(preflight.headers['access-control-allow-headers'], /authorization/);
    const login = await request(app).post('/api/auth/login').set('Origin', origin);
    assert.equal(login.status, 401);
    assert.equal(login.headers['access-control-allow-origin'], origin);
  }
});

test('other previews, suffix lookalikes and opaque origins remain blocked with safe diagnostics', async () => {
  const logs = [];
  const warn = console.warn;
  console.warn = (...args) => logs.push(args);
  try {
    for (const origin of ['https://other-preview.example.test', `${preview}.attacker.test`, 'null']) {
      const response = await request(app).get('/api/auth/registration-courses').set('Origin', origin);
      assert.equal(response.headers['access-control-allow-origin'], undefined);
      const preflight = await request(app).options('/api/auth/login').set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST');
      assert.equal(preflight.headers['access-control-allow-origin'], undefined);
    }
    assert.equal(logs.length, 6);
    assert.equal(logs[0][1].code, 'CORS_ORIGIN_DENIED');
    assert.equal(logs.at(-1)[1].origin, '[invalid origin]');
  } finally { console.warn = warn; }
  assert.equal((await request(app).get('/api/auth/registration-courses')).status, 200);
});

test('origin configuration rejects wildcards and URL paths and retains existing single-origin config', () => {
  assert.ok(getAllowedOrigins({ FRONTEND_URL: production }).has(production));
  for (const origin of ['*', 'https://*.vercel.app', `${preview}/register`, `${preview}?token=private`,
    'https://user:password@example.test', 'javascript:alert(1)']) {
    assert.throws(() => getAllowedOrigins({ FRONTEND_URLS: origin }), /Frontend origins/);
  }
});
