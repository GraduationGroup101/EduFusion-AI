const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { verifyStudentPin } = require('../lib/studentPin');
const { registration, validate, text } = require('../lib/validation');
const {
  findStudentById,
  findUserByUsername,
  listRegisterableCoursePresentations,
  registerStudentWithEnrollment,
} = require('../db/queries');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const EDUPREDICT_BASE = process.env.EDUPREDICT_API_URL || 'https://edupredict-api-6ob5.onrender.com';

const { requestUpstream } = require('../lib/upstream');
const PREDICTION_SEED_TIMEOUT_MS = Number(process.env.PREDICTION_SEED_TIMEOUT_MS || 4000);
const fetchWithTimeout = (url, timeoutMs) => requestUpstream(null, url, {}, { timeoutMs });

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  message: { error: 'Too many login attempts, please try again later' },
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const username = text(req.body?.username, 'Username', { max: 100 });
    const password = text(req.body?.password, 'Password', { max: 100000, trim: false });

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = username.trim();
    const user = await findUserByUsername(cleanUsername);
    if (!user) {
      const numericStudentId = /^\d+$/.test(cleanUsername) && Number.isSafeInteger(Number(cleanUsername)) && Number(cleanUsername) > 0 && Number(cleanUsername) <= 2147483647 ? Number(cleanUsername) : NaN;
      if (!Number.isNaN(numericStudentId)) {
        const student = await findStudentById(numericStudentId);
        if (student && await verifyStudentPin(student, password)) {
          const token = jwt.sign(
            {
              id_student: student.id_student,
              username: String(student.id_student),
              role: 'student',
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
          );

          return res.json({
            token,
            user: {
              id: student.id_student,
              id_student: student.id_student,
              username: String(student.id_student),
              student_name: student.student_name,
              role: 'student',
            },
            message: 'Login successful',
          });
        }
      }

      return res.status(401).json({ error: 'Invalid credentials' });
    }

    if (!user.is_active) {
      return res.status(401).json({ error: 'Account is deactivated' });
    }

    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
      message: 'Login successful',
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(err.statusCode || 503).json({
      error: err.statusCode === 400 ? err.message : 'Account service is temporarily unavailable',
      detail: process.env.NODE_ENV === 'production' ? undefined : err.message,
    });
  }
});

router.get('/registration-courses', async (req, res) => {
  try {
    const courses = await listRegisterableCoursePresentations();
    res.json({ courses });
  } catch (err) {
    console.error('Registration courses error:', err);
    res.status(500).json({ error: 'Failed to load registration courses' });
  }
});

const registrationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many registration attempts. Please try again later.' } });
router.post('/register-student', registrationLimiter, validate(registration), async (req, res) => {
  try {
    const registered = await registerStudentWithEnrollment(req.body);

    // The account already exists at this point. Seeding a first prediction is a
    // nice-to-have, so it runs on a short budget: if the prediction service is
    // warm the student lands on a populated dashboard, and if it is still waking
    // up we return immediately and let the request finish warming it in the
    // background instead of holding the signup open.
    const params = new URLSearchParams({
      code_module: registered.code_module,
      code_presentation: registered.code_presentation,
    });
    const predictionUrl = `${EDUPREDICT_BASE}/students/${registered.id_student}/prediction?${params}`;

    const warnings = [];
    try {
      const response = await fetchWithTimeout(predictionUrl, PREDICTION_SEED_TIMEOUT_MS);
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        warnings.push(data.detail || data.error || 'Initial prediction could not be generated');
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        warnings.push('The prediction service is starting up — your first prediction will appear shortly.');
        // Keep the warm-up going without blocking the response.
        fetchWithTimeout(predictionUrl, 80000).then((response) => response.body?.cancel?.()).catch(() => {});
      } else {
        warnings.push('Initial prediction could not be generated');
      }
    }

    const token = jwt.sign(
      {
        id_student: registered.id_student,
        username: String(registered.id_student),
        role: 'student',
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      token,
      user: {
        id: registered.id_student,
        id_student: registered.id_student,
        username: String(registered.id_student),
        student_name: req.body.student_name,
        role: 'student',
      },
      warnings,
      message: 'Student registered successfully',
    });
  } catch (err) {
    console.error('Student registration error:', err);
    res.status(err.statusCode || 503).json({ error: err.statusCode ? err.message : 'Registration service is temporarily unavailable' });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

router.post('/logout', authenticate, (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
