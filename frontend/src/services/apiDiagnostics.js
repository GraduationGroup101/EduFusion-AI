export const reportApiFailure = (error) => {
  const status = error.response?.status;
  const category = ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code) ? 'timeout'
    : !status ? 'network_or_cors'
    : [401, 403].includes(status) ? 'authorization'
    : [502, 503, 504].includes(status) ? 'service_unavailable'
    : status >= 500 ? 'server'
    : 'request_rejected';
  // Axios errors contain request bodies and Bearer headers. Never log the error
  // object, URL query, response body or credentials from its config.
  const services=['oral-exam','lecture-scribe','lecture-study','chatbot','question-generator','student','auth','dashboard','admin','services'];
  let service='unknown';
  try {service=new URL(error.config?.url||'',window.location.origin).pathname.split('/').find(part=>services.includes(part))||'unknown';}catch { /* Never print arbitrary URLs. */ }
  console.warn('API request failed:', { category, status: status || null, service });
};
