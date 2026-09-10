import axios from 'axios';

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
  if (token && !config.headers.Authorization) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
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
  me: () => api.get('/auth/me', { skipAuthRedirect: true }),
  registrationCourses: () => api.get('/auth/registration-courses'),
};

export const dashboardService = {
  getStats: () => api.get('/dashboard/stats'),
  getStudentSummary: () => api.get('/dashboard/student-summary'),
  getRecentPredictions: (limit = 10) => api.get(`/dashboard/predictions/recent?limit=${limit}`),
  getRiskDistribution: () => api.get('/dashboard/risk-distribution'),
  getCourseStats: () => api.get('/dashboard/course-stats'),
};

export const chatbotService = {
  health: () => api.get('/chatbot/health', { timeout: 25000 }),
  sendMessage: (question, session_id) => api.post('/chatbot/chat', { question, session_id }),
  getHistory: (session_id) => api.get(`/chatbot/history/${session_id}`),
  clearHistory: (session_id) => api.delete(`/chatbot/history/${session_id}`),
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
  health: () => api.get('/lecture-scribe/health'),
  createJob: ({ youtube_url, clean }) =>
    api.post('/lecture-scribe/jobs', {
      youtube_url,
      clean,
      skip_audio_cache: false,
      use_cached_outputs: true,
      language: 'ar',
    }),
  listJobs: () => api.get('/lecture-scribe/jobs'),
  getJob: (jobId) => api.get(`/lecture-scribe/jobs/${encodeURIComponent(jobId)}`),
  getTranscript: (jobId, kind = 'cleaned') =>
    api.get(`/lecture-scribe/jobs/${encodeURIComponent(jobId)}/transcript`, {
      params: { kind },
      responseType: 'text',
    }),
};

export const adminService = {
  getAtRiskStudents: (params = {}) => api.get('/admin/students/at-risk', { params }),
  getStudentPrediction: (idStudent, params = {}) => api.get(`/admin/students/${idStudent}/prediction`, { params }),
  getRiskCounts: () => api.get('/admin/predictions/risk-counts'),
  runDemoPredictions: (limit = 150) => api.post(`/admin/predictions/run-demo?limit=${limit}`),
  getClocks: () => api.get('/admin/clock'),
  tickAllClocks: (days = 1) => api.post('/admin/clock/tick-all', { days }),
  resetAllClocks: (day = 60) => api.post('/admin/clock/reset-all', { day }),
  tickClock: ({ code_module, code_presentation, days = 1 }) =>
    api.post('/admin/clock/tick', { code_module, code_presentation, days }),
  resetClock: ({ code_module, code_presentation, day = 60 }) =>
    api.post('/admin/clock/reset', { code_module, code_presentation, day }),
};

export const studentService = {
  getPredictionData: () => api.get('/student/prediction-data'),
  updatePredictionData: (enrollmentId, data) => api.put(`/student/prediction-data/${enrollmentId}`, data),
  getPrediction: (params = {}) => api.get('/student/prediction', { params }),
};

export default api;
