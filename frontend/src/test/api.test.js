import { it, expect, vi } from 'vitest';
import api, { adminService, lectureScribeService } from '../services/api';
it('uses the current stored token and removes an obsolete default', async () => {
  const seen=[];
  api.defaults.adapter=async(config)=>{seen.push(config.headers.Authorization);return {data:{},status:200,statusText:'OK',headers:{},config};};
  api.defaults.headers.common.Authorization='Bearer obsolete';
  localStorage.setItem('token','new');await api.get('/health');
  localStorage.removeItem('token');await api.get('/health');
  expect(seen).toEqual(['Bearer new',undefined]);
});
it('an unrelated LectureScribe 502 preserves authentication and identifies the failed service',async()=>{
  const adapter=api.defaults.adapter,warn=vi.spyOn(console,'warn').mockImplementation(()=>{});
  localStorage.setItem('token','healthy-exam-auth');
  api.defaults.adapter=async config=>{throw Object.assign(new Error('provider failed'),{config,response:{status:502}});};
  try {
    await expect(lectureScribeService.health()).rejects.toThrow('provider failed');
    expect(localStorage.getItem('token')).toBe('healthy-exam-auth');
    expect(warn).toHaveBeenCalledWith('API request failed: '+JSON.stringify({category:'service_unavailable',status:502,service:'lecture-scribe'}));
  } finally {api.defaults.adapter=adapter;warn.mockRestore();localStorage.clear();}
});
it('keeps the clock idempotency key after an uncertain result', async () => {
  const keys=[];let attempts=0;
  api.defaults.adapter=async(config)=>{keys.push(config.headers['Idempotency-Key']);if(attempts++===0)throw new Error('connection lost');return {data:{},status:200,statusText:'OK',headers:{},config};};
  localStorage.setItem('user',JSON.stringify({id:1}));
  await expect(adminService.tickAllClocks(1)).rejects.toThrow();
  await adminService.tickAllClocks(1);
  expect(keys[0]).toBe(keys[1]);expect(sessionStorage.length).toBe(0);
});
