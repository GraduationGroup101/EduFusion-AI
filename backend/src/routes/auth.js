const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const {
  findStudentById,
  findUserByUsername,
  listRegisterableCoursePresentations,
  registerStudentWithEnrollment,
} = require('../db/queries');
const { authenticate } = require('../middleware/auth');

const router = express.Router();
const EDUPREDICT_BASE = process.env.EDUPREDICT_API_URL || 'https://edupredict-api-6ob5.onrender.com';

const proxyFetch = async (url, options = {}) => {
  const fetch = global.fetch || (await import('node-fetch')).default;
  return fetch(url, options);
};

// EduPredict is hosted on a free Render instance that sleeps when idle; a cold
// start there has been measured at ~80s. Registration must never wait that long,
// so the seed-prediction call gets a hard budget and is treated as best-effort.
const PREDICTION_SEED_TIMEOUT_MS = Number(process.env.PREDICTION_SEED_TIMEOUT_MS || 4000);

const fetchWithTimeout = async (url, timeoutMs) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await proxyFetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'production' ? 10 : 100,
  message: { error: 'Too many login attempts, please try again later' },
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const cleanUsername = username.trim();
    const user = await findUserByUsername(cleanUsername);
    if (!user) {
      const numericStudentId = Number.parseInt(cleanUsername, 10);
      if (!Number.isNaN(numericStudentId)) {
        const student = await findStudentById(numericStudentId);
        if (student && student.pin_hash === password) {
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
    res.status(500).json({
      error: 'Internal server error',
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

// `email` is deliberately absent: it is optional, and an empty value is stored as NULL.
const REQUIRED_REGISTRATION_FIELDS = [
  'id_student',
  'pin',
  'student_name',
  'course_presentation_id',
  'gender',
  'disability',
  'age_band',
  'highest_education',
  'imd_band',
  'num_of_prev_attempts',
  'studied_credits',
];

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/register-student', async (req, res) => {
  try {
    const missing = REQUIRED_REGISTRATION_FIELDS.filter(
      (key) => req.body?.[key] === undefined || req.body?.[key] === ''
    );
    if (missing.length > 0) {
      return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    }

    if (String(req.body.pin).length < 4) {
      return res.status(400).json({ error: 'PIN must be at least 4 digits' });
    }

    // Optional email: blank/absent is fine, but a supplied one must be well-formed.
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    if (email && !EMAIL_PATTERN.test(email)) {
      return res.status(400).json({ error: 'Please enter a valid email address, or leave it empty' });
    }

    const registered = await registerStudentWithEnrollment({ ...req.body, email: email || null });

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
        proxyFetch(predictionUrl).catch(() => {});
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
    res.status(err.statusCode || 500).json({ error: err.message || 'Failed to register student' });
  }
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

router.post('/logout', authenticate, (req, res) => {
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
