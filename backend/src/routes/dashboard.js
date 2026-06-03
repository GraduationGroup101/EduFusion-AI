const express = require('express');
const { authenticate } = require('../middleware/auth');
const {
  getCourseStats,
  getDashboardStats,
  getRecentPredictions,
  getRiskDistribution,
  getStudentDashboardSummary,
} = require('../db/queries');

const router = express.Router();

router.get('/stats', authenticate, async (req, res) => {
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

router.get('/predictions/recent', authenticate, async (req, res) => {
  try {
    if (req.user.role === 'student') {
      return res.status(403).json({ error: 'Students cannot access other students predictions' });
    }
    const limit = parseInt(req.query.limit) || 10;
    const predictions = await getRecentPredictions(limit);
    res.json(predictions);
  } catch (err) {
    console.error('Predictions error:', err);
    res.status(500).json({ error: 'Failed to fetch predictions' });
  }
});

router.get('/risk-distribution', authenticate, async (req, res) => {
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

router.get('/course-stats', authenticate, async (req, res) => {
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
