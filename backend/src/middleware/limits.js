const rateLimit = require('express-rate-limit');
const { ownerKey } = require('../lib/owner');
const aiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 30,
  keyGenerator: (req) => ownerKey(req.user),
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
module.exports = { aiLimiter };
