const { pool, query } = require('../src/db');
const cleanup = async () => {
  const history = await query('DELETE FROM edufusion_chat_history WHERE expires_at<=NOW()');
  const commands = await query("DELETE FROM edufusion_clock_commands WHERE created_at<NOW()-INTERVAL '30 days'");
  console.log(`Removed ${history.rowCount} expired conversations and ${commands.rowCount} expired commands`);
};
if (require.main === module) cleanup().catch((error) => { console.error(error.message); process.exitCode=1; }).finally(() => pool.end());
module.exports = { cleanup };
