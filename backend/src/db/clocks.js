const { transaction } = require('./index');
const { ownerKey } = require('../lib/owner');
const { text, integer, badRequest } = require('../lib/validation');

const changeClock = (user, key, command) => {
  const requestKey = text(key, 'Idempotency-Key', { max: 100 });
  const input = {
    day: command.day === undefined ? null : integer(command.day, 'Day', 0, 1000),
    tickDays: integer(command.tickDays ?? 0, 'Days', 0, 365),
    module: command.module === undefined ? null : text(command.module, 'Module', { max: 20 }),
    presentation: command.presentation === undefined ? null : text(command.presentation, 'Presentation', { max: 20 }),
  };
  if ((input.module === null) !== (input.presentation === null)) throw badRequest('Module and presentation are both required');
  return transaction(async (client) => {
    const owner = ownerKey(user);
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`clock:${owner}`]);
    const old = await client.query('SELECT command,result FROM edufusion_clock_commands WHERE owner_key=$1 AND request_key=$2', [owner, requestKey]);
    if (old.rowCount) {
      if (Object.keys(input).some((name) => old.rows[0].command[name] !== input[name])) throw Object.assign(new Error('Idempotency key was used for another command'), { statusCode: 409 });
      return { ...old.rows[0].result, replayed: true };
    }
    const result = await client.query(
      `UPDATE academic_clocks ac SET current_day=LEAST(ac.max_day,GREATEST(0,COALESCE($1,ac.current_day)+$2)),
       last_tick_at=CASE WHEN $2<>0 THEN NOW() ELSE ac.last_tick_at END, updated_at=NOW()
       FROM course_presentations cp WHERE cp.id=ac.course_presentation_id
       AND ($3::text IS NULL OR (cp.code_module=$3 AND cp.code_presentation=$4))
       RETURNING ac.id,ac.current_day,ac.max_day`, [input.day, input.tickDays, input.module, input.presentation]
    );
    if (!result.rowCount) throw Object.assign(new Error('No academic clocks found'), { statusCode: 404 });
    const days = result.rows.map((row) => row.current_day);
    const output = { updatedClocks: result.rowCount, minDay: Math.min(...days), maxDay: Math.max(...days) };
    await client.query('DELETE FROM edufusion_clock_commands WHERE owner_key=$1 AND created_at<NOW()-INTERVAL \'30 days\'', [owner]);
    await client.query('INSERT INTO edufusion_clock_commands(owner_key,request_key,command,result) VALUES($1,$2,$3,$4)', [owner, requestKey, JSON.stringify(input), JSON.stringify(output)]);
    return output;
  });
};
module.exports = { changeClock };
