import api from './api';
// Lecture tools need the backend that holds the model key (the long-lived Render
// gateway in production). They share the Oral Exam override when set.
const base = import.meta.env.VITE_LECTURE_TOOLS_API_URL || import.meta.env.VITE_ORAL_EXAM_API_URL;
const options = base ? { baseURL: base } : {};
const path = (jobId, suffix) => `/lecture-scribe/jobs/${encodeURIComponent(jobId)}/${suffix}`;
export const lectureToolsService = {
  status: () => api.get('/lecture-scribe/tools/status', options),
  history: (jobId, signal) => api.get(path(jobId, 'chat'), { ...options, signal }),
  ask: (jobId, question) => api.post(path(jobId, 'chat'), { question }, { ...options, timeout: 60000 }),
  clear: (jobId) => api.delete(path(jobId, 'chat'), options),
  quizzes: (jobId, signal) => api.get(path(jobId, 'quizzes'), { ...options, signal }),
  generate: (jobId, counts) => api.post(path(jobId, 'quizzes'), counts, { ...options, timeout: 90000 }),
};
