require('dotenv').config();
const { validateEnvironment } = require('./config');
validateEnvironment();
const app = require('./app');
const { pool } = require('./db');
if (require.main === module) {
  const server = app.listen(process.env.PORT || 5000, '0.0.0.0', () => console.log('EduFusion backend is running'));
  server.requestTimeout = 30000;
  const shutdown = () => {
    const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
    server.close(async () => { await pool.end(); clearTimeout(deadline); });
  };
  process.once('SIGTERM', shutdown); process.once('SIGINT', shutdown);
}
module.exports = app;
