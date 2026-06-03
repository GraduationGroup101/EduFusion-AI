const express = require('express');
const { authenticate } = require('../middleware/auth');
const { getLatestPredictionRiskCounts, upsertChatSession } = require('../db/queries');

const router = express.Router();

const CHATBOT_BASE = process.env.CHATBOT_API_URL || 'https://iug-chatbot.onrender.com';
const EDUPREDICT_BASE = process.env.EDUPREDICT_API_URL || 'https://edupredict-api-isex.onrender.com';

const proxyFetch = async (url, options = {}) => {
  const fetch = global.fetch || (await import('node-fetch')).default;
  return fetch(url, options);
};

const personalQuestionTerms = [
  'خطر',
  'حالتي',
  'وضعي',
  'أدائي',
  'ادائي',
  'درجاتي',
  'نشاطي',
  'تسليماتي',
  'متأخر',
  'متاخر',
  'راسب',
  'risk',
  'at risk',
  'performance',
  'status',
  'grades',
];

const adminStatsTerms = [
  'كم عدد',
  'عدد الطلاب',
  'كم طالب',
  'في خطر',
  'مش في خطر',
  'ليسوا في خطر',
  'not at risk',
  'how many',
  'count',
];

const asksAboutAnotherStudent = (question, currentStudentId) => {
  const matches = String(question).match(/\d{4,}/g) || [];
  return matches.some((value) => value !== String(currentStudentId));
};

const includesAny = (question, terms) => {
  const text = String(question || '').toLowerCase();
  return terms.some((term) => text.includes(term.toLowerCase()));
};

const isPersonalAcademicQuestion = (question) => includesAny(question, personalQuestionTerms);
const isAdminStatsQuestion = (question) => includesAny(question, adminStatsTerms);

const riskLevelArabic = (level) => {
  const levels = {
    LOW: 'منخفض',
    MEDIUM: 'متوسط',
    HIGH: 'مرتفع',
  };
  return levels[level] || level;
};

const explainArabic = (reason) => {
  if (!reason) return null;
  if (reason.includes('engagement dropping')) return 'يوجد انخفاض واضح في نشاطك على المنصة.';
  if (reason.includes('no assessment submissions')) return 'لا توجد تسليمات تقييم مسجلة حتى الآن.';
  if (reason.includes('no VLE activity')) return 'لا يوجد نشاط كاف مسجل على المنصة.';
  if (reason.includes('low platform engagement')) return 'نشاطك على المنصة منخفض.';
  if (reason.includes('submitting late')) return 'يوجد تأخير في بعض التسليمات.';
  if (reason.includes('below-average scores')) return 'درجاتك أقل من المتوسط.';
  if (reason.includes('very low scores')) return 'درجاتك منخفضة جداً.';
  return reason;
};

const formatPredictionAnswer = (prediction) => {
  const probability = Math.round(prediction.risk_probability * 1000) / 10;
  const day = prediction.model_confidence?.day_of_course;
  const reasons = (prediction.explanation || [])
    .map(explainArabic)
    .filter(Boolean)
    .join('\n');

  const action = prediction.risk_level === 'HIGH'
    ? 'ننصحك بالتواصل مع المرشد الأكاديمي فوراً ومراجعة نشاطك وتسليماتك.'
    : prediction.risk_level === 'MEDIUM'
      ? 'ننصحك بمتابعة نشاطك وتسليماتك عن قرب خلال الأيام القادمة.'
      : 'وضعك الحالي جيد، استمر بالمحافظة على نشاطك وتسليماتك.';

  return [
    `حسب بياناتك حتى اليوم ${day} من الفصل، مستوى الخطر لديك ${riskLevelArabic(prediction.risk_level)} بنسبة ${probability}%.`,
    reasons ? `الأسباب:\n${reasons}` : null,
    action,
  ].filter(Boolean).join('\n\n');
};

const formatAdminCountsAnswer = (counts) => (
  [
    'حسب آخر تنبؤ محفوظ في النظام:',
    `عدد الطلاب في خطر: ${counts.at_risk_count}`,
    `عدد الطلاب غير المعرضين للخطر: ${counts.not_at_risk_count}`,
    `High Risk: ${counts.high_risk_count}`,
    `Medium Risk: ${counts.medium_risk_count}`,
    `Low Risk: ${counts.low_risk_count}`,
    `إجمالي الطلاب الذين لديهم تنبؤ محفوظ: ${counts.total_predictions}`,
  ].join('\n')
);

router.post('/chat', authenticate, async (req, res) => {
  try {
    const { question, session_id } = req.body;
    const hasStudentId = req.user.id_student !== undefined && req.user.id_student !== null;
    const sessionId = session_id || `student-${hasStudentId ? req.user.id_student : req.user.id || 'default'}`;

    if ((req.user.role === 'admin' || req.user.role === 'advisor') && isAdminStatsQuestion(question)) {
      const counts = await getLatestPredictionRiskCounts();
      return res.json({
        answer: formatAdminCountsAnswer(counts),
        session_id: sessionId,
        top_chunks: [],
        source: 'edupredict-admin',
        counts,
      });
    }

    if (hasStudentId) {
      await upsertChatSession(sessionId, req.user.id_student);
    }

    if (hasStudentId && asksAboutAnotherStudent(question, req.user.id_student)) {
      return res.json({
        answer: 'لا أستطيع عرض بيانات طالب آخر. أقدر أساعدك فقط ببيانات حسابك الحالي.',
        session_id: sessionId,
        top_chunks: [],
        source: 'edupredict',
      });
    }

    if (hasStudentId && isPersonalAcademicQuestion(question)) {
      const response = await proxyFetch(`${EDUPREDICT_BASE}/students/${req.user.id_student}/prediction`);
      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          answer: 'لم أتمكن من جلب حالتك الأكاديمية حالياً. يرجى المحاولة لاحقاً.',
          session_id: sessionId,
          detail: data.detail || data.error,
        });
      }

      return res.json({
        answer: formatPredictionAnswer(data),
        session_id: sessionId,
        top_chunks: [],
        source: 'edupredict',
        prediction: data,
      });
    }

    const response = await proxyFetch(`${CHATBOT_BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question, session_id: sessionId }),
    });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    console.error('Chat proxy error:', err);
    res.status(500).json({ error: 'Chatbot service unavailable' });
  }
});

router.get('/history/:session_id', authenticate, async (req, res) => {
  try {
    const response = await proxyFetch(`${CHATBOT_BASE}/history/${req.params.session_id}`);
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Chatbot service unavailable' });
  }
});

router.delete('/history/:session_id', authenticate, async (req, res) => {
  try {
    const response = await proxyFetch(`${CHATBOT_BASE}/history/${req.params.session_id}`, { method: 'DELETE' });
    const data = await response.json();
    res.status(response.status).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Chatbot service unavailable' });
  }
});

module.exports = router;
