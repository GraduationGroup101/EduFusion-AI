import api from './api';
const base=import.meta.env.VITE_ORAL_EXAM_API_URL;
const options=base?{baseURL:base}:{};
export const oralExamService={
  status:()=>api.get('/oral-exam/status',options),
  materials:lecture=>api.get('/oral-exam/materials',{...options,params:lecture?{lecture}:undefined}),
  sessions:()=>api.get('/oral-exam/sessions',options),
  get:(id,requestOptions={})=>api.get(`/oral-exam/sessions/${id}`,{...requestOptions,...options}),
  create:(body,key)=>api.post('/oral-exam/sessions',body,{...options,headers:{'Idempotency-Key':key}}),
  start:id=>api.post(`/oral-exam/sessions/${id}/start`,{},options),
  end:id=>api.post(`/oral-exam/sessions/${id}/end`,{},options),
  evaluate:id=>api.post(`/oral-exam/sessions/${id}/evaluation`,{},options),
};
export function socketUrl() {
  const url=new URL((base||import.meta.env.VITE_API_URL||'/api').replace(/\/$/,'')+'/oral-exam/realtime',window.location.origin);
  url.protocol=url.protocol==='https:'?'wss:':'ws:';
  return url.href;
}
