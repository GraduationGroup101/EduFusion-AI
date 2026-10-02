import axios from 'axios';
import { reportApiFailure } from './apiDiagnostics';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 90000,
});

/** Routes a signed-out visitor is allowed to sit on without being bounced to /login. */
const PUBLIC_PATHS = ['/', '/login', '/register'];

export const clearSession = () => {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  delete api.defaults.headers.common['Authorization'];
};

// Read the token per request instead of relying on a default header set at boot.
// On a page refresh the header would otherwise be missing until AuthProvider's
// effect had run, so the first call of the new page could fire unauthenticated.
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  } else {
    delete config.headers.Authorization;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    reportApiFailure(error);
    // `skipAuthRedirect` lets the caller (session bootstrap, the login form)
    // handle a 401 itself rather than triggering a full-page bounce.
    if (error.response?.status === 401 && !error.config?.skipAuthRedirect) {
      clearSession();
      if (!PUBLIC_PATHS.includes(window.location.pathname)) {
        window.location.replace('/login?expired=1');
      }
    }
    return Promise.reject(error);
  }
);

export const authService = {
  me: () => api.get('/auth/me', { skipAuthRedirect: true, timeout: 10000 }),
  registrationCourses: () => api.get('/auth/registration-courses'),
};

export const dashboardService = {
  getStats: () => api.get('/dashboard/stats'),
  getStudentSummary: () => api.get('/dashboard/student-summary'),
  getRecentPredictions: (limit = 10) => api.get(`/dashboard/predictions/recent?limit=${limit}`),
  getRiskDistribution: () => api.get('/dashboard/risk-distribution'),
  getCourseStats: () => api.get('/dashboard/course-stats'),
};

// Chat goes to the long-lived gateway (Render in production) like Oral Exam and
// lecture tools: it holds the model key that answers academic-standing questions
// and has no serverless time limit for slow university-chatbot replies. Student
// records are read there from the database, never sent from the browser.
const chatBase = import.meta.env.VITE_CHATBOT_API_URL || import.meta.env.VITE_ORAL_EXAM_API_URL;
const chatOptions = chatBase ? { baseURL: chatBase } : {};
export const chatbotService = {
  health: () => api.get('/chatbot/health', { ...chatOptions, timeout: 25000 }),
  sendMessage: (question, session_id) => api.post('/chatbot/chat', { question, session_id }, chatOptions),
  getHistory: (session_id) => api.get(`/chatbot/history/${session_id}`, chatOptions),
  clearHistory: (session_id) => api.delete(`/chatbot/history/${session_id}`, chatOptions),
};

export const questionGeneratorService = {
  health: () => api.get('/question-generator/health'),
  generate: ({ file, num_mcq, num_tf, num_essay }) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('num_mcq', String(num_mcq));
    formData.append('num_tf', String(num_tf));
    formData.append('num_essay', String(num_essay));
    return api.post('/question-generator/generate', formData, { timeout: 180000 });
  },
};

export const lectureScribeService = {
  // Bounded wait: the page retries on its own while a sleeping service wakes up.
  health: (options = {}) => api.get('/lecture-scribe/health', { timeout: 30000, ...options }),
  // `language` is always sent, including 'auto', so the server never guesses it.
  createJob: ({ youtube_url, clean, language = 'auto' }) =>
    api.post('/lecture-scribe/jobs', {
      youtube_url,
      clean,
      skip_audio_cache: false,
      use_cached_outputs: true,
      language: language || 'auto',
    }),
  listJobs: (options = {}) => api.get('/lecture-scribe/jobs', options),
  getJob: (jobId, options = {}) => api.get(`/lecture-scribe/jobs/${encodeURIComponent(jobId)}`, options),
  // Text on success; an error body is still JSON text, which the page parses for its message.
  getTranscript: (jobId, kind = 'cleaned', options = {}) =>
    api.get(`/lecture-scribe/jobs/${encodeURIComponent(jobId)}/transcript`, {
      ...options,
      params: { kind },
      responseType: 'text',
    }),
  // Admin only: every student save, newest first, with who saved it.
  adminSaves: ({ q = '', limit = 20, offset = 0 } = {}, options = {}) =>
    api.get('/lecture-scribe/admin/saves', { ...options, params: { ...(q ? { q } : {}), limit, offset } }),
};

// Keep the key after an uncertain result so a manual retry cannot tick twice.
const clockCommand = async (url, body) => {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const key = `edufusion-clock:${user.id}:${url}:${JSON.stringify(body)}`;
  const requestKey = sessionStorage.getItem(key) || crypto.randomUUID();
  sessionStorage.setItem(key, requestKey);
  try {
    const result = await api.post(url, body, { headers: { 'Idempotency-Key': requestKey } });
    sessionStorage.removeItem(key);
    return result;
  } catch (error) {
    if (error.response?.status >= 400 && error.response?.status < 500) sessionStorage.removeItem(key);
    throw error;
  }
};

export const adminService = {
  getAtRiskStudents: (params = {}) => api.get('/admin/students/at-risk', { params }),
  getStudentPrediction: (idStudent, params = {}) => api.get(`/admin/students/${idStudent}/prediction`, { params }),
  getRiskCounts: () => api.get('/admin/predictions/risk-counts'),
  runDemoPredictions: (limit = 150) => api.post(`/admin/predictions/run-demo?limit=${limit}`),
  getClocks: () => api.get('/admin/clock'),
  tickAllClocks: (days = 1) => clockCommand('/admin/clock/tick-all', { days }),
  resetAllClocks: (day = 60) => clockCommand('/admin/clock/reset-all', { day }),
  tickClock: ({ code_module, code_presentation, days = 1 }) =>
    clockCommand('/admin/clock/tick', { code_module, code_presentation, days }),
  resetClock: ({ code_module, code_presentation, day = 60 }) =>
    clockCommand('/admin/clock/reset', { code_module, code_presentation, day }),
};

export const studentService = {
  getPredictionData: (options = {}) => api.get('/student/prediction-data', options),
  saveScenario: (enrollmentId, data) => api.put(`/student/scenarios/${enrollmentId}`, data),
  applyScenarioActual: (enrollmentId, revision) => api.post(`/student/scenarios/${enrollmentId}/actual`, {confirm:true,revision}),
  getScenario: (enrollmentId, options = {}) => api.get(`/student/scenarios/${enrollmentId}`, options),
  getScenarioPrediction: (enrollmentId, options = {}) => api.get(`/student/scenarios/${enrollmentId}/prediction`, options),
  deleteScenario: (enrollmentId) => api.delete(`/student/scenarios/${enrollmentId}`),
  setScenarioPlan: (enrollmentId, adopted) => api.patch(`/student/scenarios/${enrollmentId}/plan`, { adopted }),
  getPrediction: (params = {}, options = {}) => api.get('/student/prediction', { ...options, params }),
};

export default api;
