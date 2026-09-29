const express = require('express');
const { authenticate } = require('../middleware/auth');
const { LECTURESCRIBE_BASE } = require('../lib/lectureScribe');
const { CHATBOT_BASE } = require('./chatbot');
const router = express.Router();

// Free-tier upstreams sleep when idle. A sign-in triggers a warm-up so the
// student's first real request reaches an awake service.
const base = (value, fallback) => String(value || fallback).replace(/\/+$/, '');
const warmTargets = () => [
  { name: 'lecturescribe', url: `${LECTURESCRIBE_BASE}/health` },
  { name: 'chatbot', url: `${CHATBOT_BASE}/live` },
  { name: 'question-generator', url: `${base(process.env.QUESTION_GENERATOR_API_URL, 'https://question-generator-api-pol9.onrender.com')}/health` },
  { name: 'edupredict', url: `${base(process.env.EDUPREDICT_API_URL, 'https://edupredict-api-6ob5.onrender.com')}/health` },
];

const WARM_INTERVAL_MS = 60000;
const lastWarm = new Map();
// Fire-and-forget: the response never waits for a cold start, and a target is
// pinged at most once a minute regardless of how many accounts sign in.
const warm = (targets, fetchImpl = fetch) => {
  const started = [];
  for (const target of targets) {
    const previous = lastWarm.get(target.url) || 0;
    if (Date.now() - previous < WARM_INTERVAL_MS) continue;
    lastWarm.set(target.url, Date.now());
    started.push(target.name);
    fetchImpl(target.url, { method: 'GET', headers: { Accept: 'application/json', 'User-Agent': 'EduFusion-Warmup/1.0' }, signal: AbortSignal.timeout(90000) })
      .then((response) => response.body?.cancel?.()).catch(() => {});
  }
  return started;
};

router.get('/warm-up', authenticate, (req, res) => {
  const targets = warmTargets();
  res.json({ targets, started: warm(targets) });
});

module.exports = router;
module.exports.warm = warm;
module.exports.warmTargets = warmTargets;
