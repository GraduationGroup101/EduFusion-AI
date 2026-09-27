// Never log request bodies, credentials, tokens or PostgreSQL row/detail data.
const logAccountError = (stage, error) => {
  const schemaError = ['42703', '42P01', 'MIGRATIONS_PENDING'].includes(error.code);
  console.error('Account service failure:', {
    stage,
    code: error.code || error.name,
    ...(schemaError ? {
      message: error.message,
      action: 'Run npm run migrate --prefix backend against the deployed DATABASE_URL before serving traffic.',
    } : {}),
    stack: error.stack?.split('\n').filter((line) => /^\s+at /.test(line)).join('\n'),
  });
};

module.exports = { logAccountError };
