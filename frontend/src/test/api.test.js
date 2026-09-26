import { it, expect } from 'vitest';
import api, { adminService } from '../services/api';
it('uses the current stored token and removes an obsolete default', async () => {
  const seen=[];
  api.defaults.adapter=async(config)=>{seen.push(config.headers.Authorization);return {data:{},status:200,statusText:'OK',headers:{},config};};
  api.defaults.headers.common.Authorization='Bearer obsolete';
  localStorage.setItem('token','new');await api.get('/health');
  localStorage.removeItem('token');await api.get('/health');
  expect(seen).toEqual(['Bearer new',undefined]);
});
it('keeps the clock idempotency key after an uncertain result', async () => {
  const keys=[];let attempts=0;
  api.defaults.adapter=async(config)=>{keys.push(config.headers['Idempotency-Key']);if(attempts++===0)throw new Error('connection lost');return {data:{},status:200,statusText:'OK',headers:{},config};};
  localStorage.setItem('user',JSON.stringify({id:1}));
  await expect(adminService.tickAllClocks(1)).rejects.toThrow();
  await adminService.tickAllClocks(1);
  expect(keys[0]).toBe(keys[1]);expect(sessionStorage.length).toBe(0);
});
