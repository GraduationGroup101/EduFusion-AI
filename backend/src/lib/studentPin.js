const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const { query } = require('../db');

const isHash = (value) => /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value);
const prehash = (value) => crypto.createHash('sha256').update(value, 'utf8').digest('base64');
const hashPin = async (value) => Buffer.byteLength(value, 'utf8') > 72
  ? `bcrypt-sha256$${await bcrypt.hash(prehash(value), 12)}`
  : bcrypt.hash(value, 12);
const compareHash = (password, stored) => stored.startsWith('bcrypt-sha256$')
  ? bcrypt.compare(prehash(password), stored.slice('bcrypt-sha256$'.length))
  : Buffer.byteLength(password, 'utf8') <= 72 && bcrypt.compare(password, stored);

const verifyStudentPin = async (student, password) => {
  const stored = String(student.pin_hash ?? '');
  if (typeof password !== 'string' || !password.isWellFormed() || !stored.isWellFormed()) return false;
  if (isHash(stored) || (stored.startsWith('bcrypt-sha256$') && isHash(stored.slice('bcrypt-sha256$'.length)))) return compareHash(password, stored);
  // A malformed value explicitly marked hashed never becomes plaintext. Legacy
  // provenance permits ordinary old character PINs such as "$2legacy".
  if (!stored || student.pin_format !== 'legacy') return false;
  const left = Buffer.from(stored);
  const right = Buffer.from(password);
  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) return false;
  const hash = await hashPin(password);
  const upgraded = await query(
    "UPDATE students SET pin_hash = $1, pin_format = $4 WHERE id_student = $2 AND pin_hash = $3 AND pin_format='legacy' RETURNING id_student",
    [hash, student.id_student, stored, hash.startsWith('bcrypt-sha256$') ? 'bcrypt-sha256' : 'bcrypt']
  );
  if (upgraded.rowCount === 1) return true;
  // Another login or a reset can race the conditional upgrade. Verify the
  // current credential before issuing a token, never overwrite that change.
  const current = await query('SELECT pin_hash FROM students WHERE id_student = $1', [student.id_student]);
  const now = current.rows[0]?.pin_hash || '';
  return isHash(now) || (now.startsWith('bcrypt-sha256$') && isHash(now.slice('bcrypt-sha256$'.length)))
    ? compareHash(password, now) : false;
};

module.exports = { verifyStudentPin, hashPin, isHash };
