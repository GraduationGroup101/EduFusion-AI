const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

const object = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('A JSON object is required');
  return value;
};

const text = (value, name, { min = 1, max = 200, trim = true } = {}) => {
  if (typeof value !== 'string') throw badRequest(`${name} must be text`);
  if (!value.isWellFormed()) throw badRequest(`${name} contains invalid Unicode`);
  const result = trim ? value.trim() : value;
  if (result.length < min || result.length > max) throw badRequest(`${name} must contain ${min}–${max} characters`);
  return result;
};

const integer = (value, name, min = 0, max = 2147483647) => {
  if (!(typeof value === 'number' || (typeof value === 'string' && /^-?\d+$/.test(value)))) {
    throw badRequest(`${name} must be an integer`);
  }
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw badRequest(`${name} must be between ${min} and ${max}`);
  return result;
};

const choice = (value, name, options) => {
  if (!options.includes(value)) throw badRequest(`Invalid ${name}`);
  return value;
};

const registration = (body) => {
  object(body);
  const pin = text(body.pin, 'PIN', { min: 4, max: 72, trim: false });
  if (Buffer.byteLength(pin, 'utf8') > 72) throw badRequest('PIN must be at most 72 UTF-8 bytes');
  const email = body.email == null || body.email === '' ? null : text(body.email, 'Email', { max: 254 });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('Invalid email address');
  return {
    id_student: integer(body.id_student, 'Student ID', 1),
    course_presentation_id: integer(body.course_presentation_id, 'Course', 1),
    pin, email,
    student_name: text(body.student_name, 'Full name'),
    gender: choice(body.gender, 'gender', ['M', 'F']),
    disability: choice(body.disability, 'disability', ['N', 'Y']),
    age_band: choice(body.age_band, 'age band', ['0-35', '35-55', '55<=']),
    highest_education: choice(body.highest_education, 'education', ['No Formal quals', 'Lower Than A Level', 'A Level or Equivalent', 'HE Qualification', 'Post Graduate Qualification']),
    imd_band: choice(body.imd_band, 'IMD band', ['0-10%', '10-20%', '20-30%', '30-40%', '40-50%', '50-60%', '60-70%', '70-80%', '80-90%', '90-100%']),
    region: body.region === undefined ? 'Unknown' : text(body.region, 'Region', { max: 100 }),
    num_of_prev_attempts: integer(body.num_of_prev_attempts, 'Previous attempts', 0, 100),
    studied_credits: integer(body.studied_credits, 'Studied credits', 1, 1000),
    date_registration: integer(body.date_registration ?? 0, 'Registration day', -365, 1000),
  };
};

const scenario = (body) => {
  object(body);
  const allowed = ['quiz_clicks', 'forum_clicks', 'resource_clicks', 'activity_days', 'latest_tma_score', 'tma_delay_days', 'latest_cma_score', 'cma_delay_days', 'new_submission_type', 'new_submission_score', 'new_submission_delay_days'];
  for (const key of Object.keys(body)) if (!allowed.includes(key)) throw badRequest(`Unknown scenario field: ${key}`);
  const result = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'new_submission_type') result[key] = choice(value, key, ['TMA', 'CMA']);
    else result[key] = integer(value, key, key === 'activity_days' ? 1 : 0, key.includes('score') ? 100 : 50000);
  }
  return result;
};

const validate = (parser, location = 'body') => (req, res, next) => {
  try { req[location] = parser(req[location]); next(); }
  catch (error) { res.status(error.statusCode || 400).json({ error: error.message }); }
};

module.exports = { badRequest, object, text, integer, choice, registration, scenario, validate };
