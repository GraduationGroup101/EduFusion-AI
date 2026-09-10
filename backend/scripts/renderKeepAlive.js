const { Pool } = require('pg');

const DEFAULT_CHATBOT_URL = 'https://final-iug-chat-botv2.onrender.com';
const DEFAULT_EDUPREDICT_URL = 'https://edupredict-api-6ob5.onrender.com';
const REQUEST_TIMEOUT_MS = Number(process.env.KEEP_ALIVE_TIMEOUT_MS || 90000);

const healthUrl = (explicitUrl, baseUrl, path) => {
  if (explicitUrl) return explicitUrl;
  return `${String(baseUrl).replace(/\/$/, '')}${path}`;
};

const endpoints = [
  {
    name: 'chatbot',
    url: healthUrl(
      process.env.CHATBOT_HEALTH_URL,
      process.env.CHATBOT_API_URL || DEFAULT_CHATBOT_URL,
      '/live'
    ),
  },
  {
    name: 'prediction-api',
    url: healthUrl(
      process.env.EDUPREDICT_HEALTH_URL,
      process.env.EDUPREDICT_API_URL || DEFAULT_EDUPREDICT_URL,
      '/health'
    ),
  },
];

const pingHttp = async ({ name, url }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'User-Agent': 'EduFusion-Render-Health/1.0',
      },
      signal: controller.signal,
    });
    const body = await response.text();

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${body.slice(0, 160)}`);
    }

    return `${name} OK (${Date.now() - startedAt} ms)`;
  } finally {
    clearTimeout(timer);
  }
};

const pingDatabase = async () => {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL GitHub secret is not configured');
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 1,
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 1000,
    application_name: 'edufusion_keep_alive',
  });
  const startedAt = Date.now();

  try {
    await pool.query('SELECT 1');
    return `database OK (${Date.now() - startedAt} ms)`;
  } finally {
    await pool.end();
  }
};

const main = async () => {
  const checks = [
    ...endpoints.map((endpoint) => pingHttp(endpoint)),
    pingDatabase(),
  ];
  const results = await Promise.allSettled(checks);
  const failures = [];

  results.forEach((result, index) => {
    const name = index < endpoints.length ? endpoints[index].name : 'database';
    if (result.status === 'fulfilled') {
      console.log(result.value);
    } else {
      const message = result.reason?.message || String(result.reason);
      console.error(`${name} FAILED: ${message}`);
      failures.push(name);
    }
  });

  if (failures.length) {
    throw new Error(`Keep-alive checks failed: ${failures.join(', ')}`);
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
