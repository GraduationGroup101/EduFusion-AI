const bcrypt = require('bcryptjs');
const { pool, transaction } = require('../src/db');
const seed = async () => {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production');
  if (!process.env.DEMO_ADMIN_PASSWORD) throw new Error('Set DEMO_ADMIN_PASSWORD to seed an administrator');
  const hash = await bcrypt.hash(process.env.DEMO_ADMIN_PASSWORD, 12);
  await transaction(async (client) => {
    await client.query("INSERT INTO app_users(username,password_hash,role) VALUES('demo-admin',$1,'admin') ON CONFLICT(username) DO NOTHING", [hash]);
    const course = await client.query("INSERT INTO course_presentations(code_module,code_presentation,module_presentation_length) VALUES('DEMO','2026',240) ON CONFLICT(code_module,code_presentation) DO UPDATE SET module_presentation_length=EXCLUDED.module_presentation_length RETURNING id");
    const id = course.rows[0].id;
    await client.query('INSERT INTO academic_clocks(course_presentation_id,current_day,max_day) VALUES($1,60,240) ON CONFLICT(course_presentation_id) DO NOTHING', [id]);
    await client.query("INSERT INTO assessments(id_assessment,course_presentation_id,assessment_type,date,weight) VALUES(2000000001,$1,'TMA',30,50),(2000000002,$1,'CMA',90,50) ON CONFLICT(id_assessment) DO NOTHING", [id]);
    await client.query("INSERT INTO vle_sites(id_site,course_presentation_id,activity_type) VALUES(2000000001,$1,'quiz'),(2000000002,$1,'forumng'),(2000000003,$1,'resource') ON CONFLICT(id_site) DO NOTHING", [id]);
  });
  console.log('Demo course and administrator are ready');
};
if (require.main === module) seed().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
module.exports = { seed };
