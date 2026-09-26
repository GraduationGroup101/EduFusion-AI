const express = require('express');
const { authenticate, requireRole } = require('../middleware/auth');
const { integer } = require('../lib/validation');
const {
  getCourseStats,
  getDashboardStats,
  getRecentPredictions,
  getRiskDistribution,
  getStudentDashboardSummary,
} = require('../db/queries');

const router = express.Router();

router.get('/stats', authenticate, requireRole(['admin','advisor']), async (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Students cannot access aggregate dashboard stats' });
    }
    const stats = await getDashboardStats();
    res.json(stats);
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

router.get('/student-summary', authenticate, async (req, res) => {
  try {
    if (req.user.role !== 'student' || req.user.id_student === undefined || req.user.id_student === null) {
      return res.status(403).json({ error: 'Student account required' });
    }

    const summary = await getStudentDashboardSummary(req.user.id_student);
    res.json(summary);
  } catch (err) {
    console.error('Student summary error:', err);
    res.status(500).json({ error: 'Failed to fetch student summary' });
  }
});

router.get('/predictions/recent', authenticate, requireRole(['admin','advisor']), async (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Students cannot access other students predictions' });
    }
    const limit = integer(req.query.limit ?? 10, 'Limit', 1, 1000);
    const predictions = await getRecentPredictions(limit);
    res.json(predictions);
  } catch (err) {
    console.error('Predictions error:', err);
    res.status(err.statusCode || 503).json({ error: err.statusCode === 400 ? err.message : 'Failed to fetch predictions' });
  }
});

router.get('/risk-distribution', authenticate, requireRole(['admin','advisor']), async (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Students cannot access aggregate risk distribution' });
    }
    const data = await getRiskDistribution();
    res.json(data);
  } catch (err) {
    console.error('Risk distribution error:', err);
    res.status(500).json({ error: 'Failed to fetch risk distribution' });
  }
});

router.get('/course-stats', authenticate, requireRole(['admin','advisor']), async (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Students cannot access aggregate course stats' });
    }
    const data = await getCourseStats();
    res.json(data);
  } catch (err) {
    console.error('Course stats error:', err);
    res.status(500).json({ error: 'Failed to fetch course stats' });
  }
});

module.exports = router;
