const crypto = require('node:crypto');
const { text, integer, object, badRequest } = require('../lib/validation');
const id = (value) => {
  const result = text(value, 'ID', { max: 36 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) throw badRequest('Invalid ID');
  return result;
};
const requestKey = (req) => text(req.get('Idempotency-Key'), 'Idempotency-Key', { max: 100 });
const source = (body) => {
  object(body);
  let url;
  try { url = new URL(text(body.youtube_url, 'YouTube URL', { max: 2048 })); }
  catch { throw badRequest('Enter a YouTube HTTPS URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !['youtube.com','www.youtube.com','m.youtube.com','youtu.be'].includes(url.hostname)) throw badRequest('Enter a YouTube HTTPS URL');
  const video = url.hostname === 'youtu.be' ? url.pathname.slice(1).split('/')[0] :
    url.pathname === '/watch' ? url.searchParams.get('v') : url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)\/?$/)?.[1];
  if (!/^[\w-]{11}$/.test(video || '')) throw badRequest('Invalid YouTube video ID');
  const language = body.language ?? 'auto';
  if (!['auto','ar','en'].includes(language)) throw badRequest('Unsupported language');
  return { youtube_url: 'https://www.youtube.com/watch?v=' + video, language,
    source_key: video + ':' + language + ':study-v1',
    enrollment_id: body.enrollment_id == null || body.enrollment_id === '' ? null : integer(body.enrollment_id, 'Enrollment', 1),
    title: body.title ? text(body.title, 'Title', { max: 200 }) : 'Lecture ' + video };
};
const counts = (body) => {
  object(body);
  const result = {};
  for (const [name, fallback] of [['mcq',6],['tf',3],['essay',1]]) result[name] = integer(body[name] ?? fallback, name, 0, 10);
  if (!Object.values(result).some(Boolean)) throw badRequest('Choose at least one question');
  return { ...result, section: body.section ? text(body.section, 'Section', { max: 100 }) : null };
};
const publicQuiz = (quiz) => ({ id:quiz.id,lecture_id:quiz.lecture_id,version:quiz.version,created_at:quiz.created_at,
  questions: quiz.questions.map(({id,type,prompt,choices,concept,citations}) => ({id,type,prompt,choices,concept,citations})) });
const grade = (questions, answers) => {
  object(answers);
  if (Object.keys(answers).some((key) => !questions.some((question) => question.id === key))) throw badRequest('Unknown question');
  let score = 0, total = 0;
  const feedback = questions.map((question) => {
    const answer = answers[question.id];
    if (question.type === 'essay') {
      if (answer !== undefined) text(answer, 'Essay answer', { min: 0, max: 4000 });
      return { ...question, submitted_answer: answer ?? '', correct: null, assessment: 'Self-assessment: compare with the model answer and rubric.' };
    }
    total++;
    if (answer !== undefined && (question.type === 'mcq'
      ? !Number.isInteger(answer) || answer < 0 || answer >= question.choices.length
      : typeof answer !== 'boolean')) throw badRequest('Invalid answer type');
    const correct = answer === question.answer;
    if (correct) score++;
    return { ...question, submitted_answer: answer ?? null, correct };
  });
  return { score, total, feedback };
};
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ?
  Object.fromEntries(Object.keys(value).sort().map((key) => [key,canonical(value[key])])) : value;
const fingerprint = (value) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
module.exports = { id, requestKey, source, counts, publicQuiz, grade, fingerprint };
