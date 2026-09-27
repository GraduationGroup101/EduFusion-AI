const express = require('express');
const cors = require('cors');
const { readQuery } = require('./db');
const app = express();
app.set('trust proxy', Number(process.env.TRUST_PROXY ?? ((process.env.VERCEL || process.env.RENDER) ? 1 : 0)));
app.disable('x-powered-by');
app.use(cors({ origin: ['http://localhost:3000','http://localhost:5173',process.env.FRONTEND_URL].filter(Boolean), credentials: true }));
app.use((req, res, next) => { res.set('X-Content-Type-Options','nosniff'); res.set('Cache-Control','no-store'); next(); });
app.use(express.json({ limit: '128kb' }));
for (const [path, file] of Object.entries({ auth:'auth', dashboard:'dashboard', chatbot:'chatbot', admin:'admin', student:'student', 'question-generator':'questionGenerator', 'lecture-scribe':'lectureScribe' })) {
  app.use(`/api/${path}`, require(`./routes/${file}`));
}
app.use('/api/lecture-study', require('./routes/lectureStudy'));
app.get('/api/health', (req,res) => res.json({ status:'ok', timestamp:new Date().toISOString() }));
app.get('/api/ready', async (req,res) => {
  try {
    await readQuery('SELECT 1 FROM edufusion_schema_migrations LIMIT 1');
    await readQuery('SELECT 1 FROM edufusion_clock_commands LIMIT 1');
    res.json({status:'ready'});
  } catch { res.status(503).json({error:'Database or migrations are unavailable'}); }
});
app.use('/api', (req,res) => res.status(404).json({error:'Endpoint not found'}));
app.use((error,req,res,next) => {
  if(res.headersSent) return next(error);
  const status = error.statusCode || error.status || 500;
  if(status>=500) console.error('Request failed:', error.code || error.name);
  return res.status(status).json({error: status===413 ? 'Request is too large' : status===400 ? 'Invalid request' : 'Something went wrong'});
});
module.exports = app;
