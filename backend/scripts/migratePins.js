const { pool, query } = require('../src/db');
const { hashPin, isHash } = require('../src/lib/studentPin');
const run = async () => {
  // Never print credential values. Conditional updates preserve concurrent resets.
  const students = await query('SELECT id_student,pin_hash,pin_format FROM students');
  let count = 0;
  for (const student of students.rows) {
    const value = String(student.pin_hash ?? '');
    if (!value || isHash(value) || (value.startsWith('bcrypt-sha256$') && isHash(value.slice('bcrypt-sha256$'.length)))) continue;
    if (student.pin_format !== 'legacy') throw new Error(`Malformed hash for student ${student.id_student}; reset the credential explicitly`);
    const hash = await hashPin(value);
    const changed = await query("UPDATE students SET pin_hash=$1,pin_format=$4 WHERE id_student=$2 AND pin_hash=$3 AND pin_format='legacy'", [hash, student.id_student, value, hash.startsWith('bcrypt-sha256$') ? 'bcrypt-sha256' : 'bcrypt']);
    count += changed.rowCount;
  }
  console.log(`Upgraded ${count} student PINs`);
};
if (require.main === module) run().catch((error) => { console.error(error.message); process.exitCode = 1; }).finally(() => pool.end());
module.exports = { run };
