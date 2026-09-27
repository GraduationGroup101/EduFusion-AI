const jwt = require('jsonwebtoken');
const { getStudentUserById, getUserById } = require('../db/queries');
const { logAccountError } = require('../lib/accountError');

const authenticate = async (req, res, next) => {
  let stage = 'token_verification';
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const hasStudentId = Object.prototype.hasOwnProperty.call(decoded, 'id_student');
    stage = hasStudentId ? 'student_session_lookup' : 'application_session_lookup';
    const user = hasStudentId
      ? await getStudentUserById(decoded.id_student)
      : await getUserById(decoded.id);

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (['JsonWebTokenError', 'NotBeforeError'].includes(err.name)) {
      return res.status(401).json({ error: 'Invalid token' });
    }
    logAccountError(stage, err);
    return res.status(503).json({ error: 'Account service is temporarily unavailable' });
  }
};

const requireRole = (roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }
  next();
};

module.exports = { authenticate, requireRole };
