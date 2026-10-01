import {render,screen,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import api from '../services/api';
import {AuthProvider,useAuth} from '../context/AuthContext';
import {resetWarmup,warmServices} from '../services/warmup';
const targets=[{name:'lecturescribe',url:'https://lecturescribe-ai.onrender.com/health'},{name:'chatbot',url:'https://final-iug-chat-botv3.onrender.com/live'}];
let requests=[];
beforeEach(()=>{
  requests=[];resetWarmup();
  api.defaults.adapter=async(config)=>{
    requests.push(config.url);
    const data=config.url==='/auth/me'?{user:{id_student:5,role:'student'}}:config.url==='/auth/login'?{token:'t',user:{id_student:5,role:'student'}}:{targets};
    return {data,status:200,statusText:'OK',headers:{},config};
  };
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue({}));
});
function Login(){const {login,user}=useAuth();return <button onClick={()=>login('5','pin')}>{user?'signed in':'sign in'}</button>;}
it('wakes the transcription and chatbot services from the browser once a session exists',async()=>{
  render(<AuthProvider><Login/></AuthProvider>);
  (await screen.findByRole('button',{name:'sign in'})).click();
  await screen.findByRole('button',{name:'signed in'});
  await waitFor(()=>expect(requests).toContain('/services/warm-up'));
  await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
  expect(fetch).toHaveBeenCalledWith('https://lecturescribe-ai.onrender.com/health',expect.objectContaining({mode:'no-cors',credentials:'omit'}));
  expect(fetch).toHaveBeenCalledWith('https://final-iug-chat-botv3.onrender.com/live',expect.objectContaining({mode:'no-cors'}));
  expect(await warmServices()).toEqual([]);
  expect(requests.filter(url=>url==='/services/warm-up')).toHaveLength(1);
});
it('warms services for a restored session and ignores non-https targets',async()=>{
  localStorage.setItem('token','stored');localStorage.setItem('user',JSON.stringify({id_student:5,role:'student'}));
  targets.push({name:'bad',url:'http://internal/health'});
  render(<AuthProvider><Login/></AuthProvider>);
  await screen.findByRole('button',{name:'signed in'});
  await waitFor(()=>expect(fetch).toHaveBeenCalledTimes(2));
  targets.pop();
});
