import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '/api',
  timeout: 90000,
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const dashboardService = {
  getStats: () => api.get('/dashboard/stats'),
  getStudentSummary: () => api.get('/dashboard/student-summary'),
  getRecentPredictions: (limit = 10) => api.get(`/dashboard/predictions/recent?limit=${limit}`),
  getRiskDistribution: () => api.get('/dashboard/risk-distribution'),
  getCourseStats: () => api.get('/dashboard/course-stats'),
};

export const chatbotService = {
  sendMessage: (question, session_id) => api.post('/chatbot/chat', { question, session_id }),
  getHistory: (session_id) => api.get(`/chatbot/history/${session_id}`),
  clearHistory: (session_id) => api.delete(`/chatbot/history/${session_id}`),
};

export const chatbotFilesService = {
  uploadFile: ({ file, collection_name }) => {
    const formData = new FormData();
    formData.append('file', file);
    if (collection_name?.trim()) {
      formData.append('collection_name', collection_name.trim());
    }
    return api.post('/chatbot-files/upload-file', formData, { timeout: 180000 });
  },
  chatWithFile: ({ question, collection_name, session_id = 'default' }) =>
    api.post('/chatbot-files/chat/file', { question, collection_name, session_id }),
  listFiles: () => api.get('/chatbot-files/files/list'),
  deleteFile: (collection_name) => api.delete(`/chatbot-files/files/${encodeURIComponent(collection_name)}`),
  reloadFile: (collection_name) => api.post(`/chatbot-files/files/${encodeURIComponent(collection_name)}/reload`),
  getChunks: (collection_name) => api.get(`/chatbot-files/files/${encodeURIComponent(collection_name)}/chunks`),
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
