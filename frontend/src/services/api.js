import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
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

export const adminService = {
  getAtRiskStudents: (params = {}) => api.get('/admin/students/at-risk', { params }),
  runDemoPredictions: (limit = 150) => api.post(`/admin/predictions/run-demo?limit=${limit}`),
  getClocks: () => api.get('/admin/clock'),
  tickClock: ({ code_module, code_presentation, days = 1 }) =>
    api.post('/admin/clock/tick', { code_module, code_presentation, days }),
  resetClock: ({ code_module, code_presentation, day = 60 }) =>
    api.post('/admin/clock/reset', { code_module, code_presentation, day }),
};

export default api;
