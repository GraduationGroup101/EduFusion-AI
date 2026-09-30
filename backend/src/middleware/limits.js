const rateLimit = require('express-rate-limit');
const { ownerKey } = require('../lib/owner');
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30,
  keyGenerator: (req) => ownerKey(req.user),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
// Document extraction is CPU-bound, so uploads get their own per-student budget.
const materialLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 20,
  keyGenerator: (req) => ownerKey(req.user),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many uploads. Please wait a few minutes and try again.' },
});
module.exports = { aiLimiter, materialLimiter };
