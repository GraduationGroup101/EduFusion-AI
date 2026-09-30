const express = require('express');
const cors = require('cors');
const { assertDatabaseReady } = require('./db/readiness');
const { logAccountError } = require('./lib/accountError');
const { createCorsOptions } = require('./lib/corsOrigins');
const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? ((process.env.VERCEL || process.env.RENDER) ? 1 : 0)));
app.disable('x-powered-by');
app.use(cors(createCorsOptions()));
app.use((req, res, next) => { res.set('X-Content-Type-Options','nosniff'); res.set('Cache-Control','no-store'); next(); });
app.use(express.json({ limit: '128kb' }));
for (const [path, file] of Object.entries({ auth:'auth', dashboard:'dashboard', chatbot:'chatbot', admin:'admin', student:'student', 'question-generator':'questionGenerator', 'lecture-scribe':'lectureScribe' })) {
  app.use(`/api/${path}`, require(`./routes/${file}`));
}
app.use('/api/lecture-study', require('./routes/lectureStudy'));
app.use('/api/oral-exam', require('./routes/oralExam'));
app.use('/api/services', require('./routes/services'));
app.get('/api/health', (req,res) => res.json({ status:'ok', timestamp:new Date().toISOString(), revision:process.env.RENDER_GIT_COMMIT||process.env.VERCEL_GIT_COMMIT_SHA||null }));
app.get('/api/ready', async (req,res) => {
  try {
    await assertDatabaseReady();
    res.json({status:'ready'});
  } catch (error) {
    logAccountError('database_readiness', error);
    res.status(503).json({error:'Database or migrations are unavailable'});
  }
});
app.use('/api', (req,res) => res.status(404).json({error:'Endpoint not found'}));
app.use((error,req,res,next) => {
  if(res.headersSent) return next(error);
  const status = error.statusCode || error.status || 500;
  if(status>=500) console.error('Request failed:', error.code || error.name);
  return res.status(status).json({error: status===413 ? 'Request is too large' : status===400 ? 'Invalid request' : 'Something went wrong'});
});
module.exports = app;
