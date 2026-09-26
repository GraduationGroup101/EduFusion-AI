import api from './api';
const prefix = '/lecture-study';
const write = (path,body,key) => api.post(prefix + path,body,{headers:{'Idempotency-Key':key}});
export const lectureStudyService = {
  status: () => api.get(prefix + '/status'),
  list: (offset=0) => api.get(prefix + '/lectures',{params:{offset}}),
  create: (body,key) => write('/lectures',body,key),
  import: (job_id,key) => write('/import',{job_id},key),
  lecture: (id,signal) => api.get(prefix + '/lectures/' + id,{signal}),
  remove: (id) => api.delete(prefix + '/lectures/' + id),
  messages: (id,signal) => api.get(prefix + '/lectures/' + id + '/messages',{signal}),
  clearMessages: (id) => api.delete(prefix + '/lectures/' + id + '/messages'),
  ask: (id,question,key) => write('/lectures/' + id + '/messages',{question},key),
  quizzes: (id,signal) => api.get(prefix + '/lectures/' + id + '/quizzes',{signal}),
  generate: (id,counts,key) => write('/lectures/' + id + '/quizzes',counts,key),
  quiz: (id,signal) => api.get(prefix + '/quizzes/' + id,{signal}),
  submit: (id,answers,key) => write('/quizzes/' + id + '/attempts',{answers},key),
  attempts: (id,signal) => api.get(prefix + '/lectures/' + id + '/attempts',{signal}),
  recommendations: (id,signal) => api.get(prefix + '/lectures/' + id + '/recommendations',{signal}),
  job: (id,signal) => api.get(prefix + '/jobs/' + id,{signal}),
  retry: (id) => api.post(prefix + '/jobs/' + id + '/retry'),
};
