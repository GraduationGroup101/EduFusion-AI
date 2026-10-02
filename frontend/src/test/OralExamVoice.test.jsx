import {act,renderHook} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {useOralExamVoice} from '../hooks/useOralExamVoice';
vi.mock('../services/oralExam',()=>({socketUrl:()=> 'ws://fixture/api/oral-exam/realtime'}));
let sockets,track;
class Socket {
  constructor(){this.readyState=0;this.bufferedAmount=0;this.sent=[];sockets.push(this);}
  send(raw){this.sent.push(JSON.parse(raw));}
  close(){this.readyState=2;}
  open(){this.readyState=1;this.onopen?.();}
  message(msg){this.onmessage?.({data:JSON.stringify(msg)});}
  closed(code=1006,reason=''){this.readyState=3;this.onclose?.({code,reason});}
}
class Context {
  sampleRate=16000;state='running';destination={};
  audioWorklet={addModule:async()=>{}};
  resume=async()=>{};close=async()=>{};
  createMediaStreamSource=()=>({connect(){},disconnect(){}});
  createGain=()=>({gain:{value:1},connect(){}});
  async decodeAudioData(){return {};}
  createBufferSource=()=>({connect(){},start(){},stop(){}});
}
const snapshot=(elapsed=0)=>({id:'exam-1',status:'active',expires_at:new Date(600000).toISOString(),server_now:new Date(elapsed).toISOString()});
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(0);sockets=[];track={stop:vi.fn(),enabled:true};
  vi.stubGlobal('WebSocket',Socket);vi.stubGlobal('AudioContext',Context);
  vi.stubGlobal('AudioWorkletNode',class {port={};connect(){}disconnect(){}});
  Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:async()=>({getTracks:()=>[track],getAudioTracks:()=>[track]})}});
  localStorage.setItem('token','fixture-auth');
});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();localStorage.clear();});
async function ready(){
  const onSession=vi.fn();const hook=renderHook(()=>useOralExamVoice(onSession));
  await act(async()=>{expect(await hook.result.current.checkMic()).toBe(true);});
  act(()=>hook.result.current.connect(snapshot()));
  return {...hook,onSession};
}
function welcome(socket){
  act(()=>{socket.open();socket.message({type:'welcome',session:snapshot(Date.now())});socket.message({type:'state',state:'listening'});});
}
it('keeps a normal connection and the original deadline alive for eight minutes',async()=>{
  const hook=await ready();welcome(sockets[0]);
  for(let i=0;i<96;i++)act(()=>{vi.advanceTimersByTime(5000);sockets[0].message({type:'clock',...snapshot(Date.now())});});
  expect(sockets).toHaveLength(1);expect(hook.result.current.state).toBe('listening');
  expect(hook.onSession.mock.calls.at(-1)[0].expires_at).toBe(snapshot().expires_at);
  act(()=>vi.advanceTimersByTime(120000));
  expect(hook.result.current.state).toBe('closing');act(()=>vi.advanceTimersByTime(8000));expect(hook.result.current.state).toBe('ended');expect(track.stop).toHaveBeenCalled();
  hook.unmount();
});
it('reconnects a server-side close with a private resume credential and the same session',async()=>{
  const hook=await ready();welcome(sockets[0]);
  const connectionKey=sockets[0].sent[0].connectionKey;
  act(()=>sockets[0].closed(4500,'Connection unavailable'));
  act(()=>vi.advanceTimersByTime(1100));
  expect(sockets).toHaveLength(2);act(()=>sockets[1].open());
  expect(sockets[0].sent[0].connectionAttempt).toBe(1);
  expect(sockets[1].sent[0]).toMatchObject({type:'hello',sessionId:'exam-1',connectionKey,connectionAttempt:2});
  act(()=>sockets[1].message({type:'welcome',session:snapshot(Date.now())}));
  expect(hook.result.current.error).toBe('');hook.unmount();
});
it('keeps its instance key when welcome is lost, and creates a different key for another mounted page',async()=>{
  const first=await ready();act(()=>sockets[0].open());const key=sockets[0].sent[0].connectionKey;
  act(()=>sockets[0].closed());act(()=>vi.advanceTimersByTime(1100));act(()=>sockets[1].open());
  expect(sockets[1].sent[0].connectionKey).toBe(key);
  const second=await ready();act(()=>sockets[2].open());
  expect(sockets[2].sent[0].connectionKey).not.toBe(key);expect(localStorage.getItem('connectionKey')).toBeNull();
  first.unmount();second.unmount();
});
it('ignores late events from a replaced socket during rapid connect',async()=>{
  const hook=await ready();const old=sockets[0];welcome(old);
  act(()=>hook.result.current.connect(snapshot()));
  const current=sockets[1];welcome(current);
  act(()=>{old.closed(4403,'Late close');old.message({type:'error',message:'Late error'});});
  act(()=>vi.advanceTimersByTime(1000));
  expect(sockets).toHaveLength(2);expect(hook.result.current.state).toBe('listening');expect(hook.result.current.error).toBe('');
  hook.unmount();
});
it('a watchdog reconnects even when the previous close handshake never finishes',async()=>{
  const hook=await ready();welcome(sockets[0]);
  act(()=>vi.advanceTimersByTime(21200));
  expect(sockets).toHaveLength(2);
  act(()=>sockets[0].closed());
  act(()=>{sockets[1].open();sockets[1].message({type:'welcome',session:snapshot(Date.now())});sockets[1].message({type:'state',state:'listening'});});
  act(()=>vi.advanceTimersByTime(1000));
  expect(sockets).toHaveLength(2);expect(hook.result.current.state).toBe('listening');hook.unmount();
});
it('stopping a pending reconnect releases the microphone and prevents another dial',async()=>{
  const hook=await ready();welcome(sockets[0]);act(()=>sockets[0].closed());
  act(()=>hook.result.current.stop());act(()=>vi.advanceTimersByTime(60000));
  expect(sockets).toHaveLength(1);expect(track.stop).toHaveBeenCalled();hook.unmount();
});
it('a real ownership conflict and expired authentication stop automatic reconnect',async()=>{
  for(const code of [4409,4401]){
    const hook=await ready();welcome(sockets.at(-1));const count=sockets.length;
    act(()=>sockets.at(-1).closed(code));act(()=>vi.advanceTimersByTime(10000));
    expect(sockets).toHaveLength(count);expect(hook.result.current.state).toBe('error');hook.unmount();
  }
});

// A minimal Web Locks implementation: exclusive named locks, ifAvailable and abort signals.
function installLocks(){
  const held=new Set(),waiting=new Map();
  const request=(name,options,callback)=>new Promise((resolve,reject)=>{
    const grant=()=>{held.add(name);Promise.resolve(callback({name})).then(value=>{held.delete(name);waiting.get(name)?.shift()?.();resolve(value);},reject);};
    if(!held.has(name))return grant();
    if(options.ifAvailable)return Promise.resolve(callback(null)).then(resolve,reject);
    const queue=waiting.get(name)||[];waiting.set(name,queue);queue.push(grant);
    options.signal?.addEventListener('abort',()=>{queue.splice(queue.indexOf(grant),1);reject(new DOMException('Aborted','AbortError'));});
  });
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request}});
  vi.spyOn(AbortSignal,'timeout').mockImplementation(ms=>{const controller=new AbortController();setTimeout(()=>controller.abort(),ms);return controller.signal;});
}
async function helloKey(socket){
  await act(async()=>{socket.open();await vi.advanceTimersByTimeAsync(0);});
  return socket.sent[0]?.connectionKey;
}
it('a refreshed tab reclaims its orphaned connection with the same resume key',async()=>{
  installLocks();
  const before=await ready();const key=await helloKey(sockets[0]);
  expect(key).toMatch(/^[0-9a-f-]{36}$/);
  // Refresh: the page unloads without a server-side close, then mounts again in the same tab.
  before.unmount();
  const after=await ready();
  expect(await helloKey(sockets[1])).toBe(key);
  // The server only lets a strictly newer attempt of the same key reclaim the exam.
  expect(sockets[1].sent[0].connectionAttempt).toBeGreaterThan(sockets[0].sent[0].connectionAttempt);
  after.unmount();delete navigator.locks;
});
it('a duplicated tab inherits the stored key but must use its own while the original is alive',async()=>{
  installLocks();
  const original=await ready();const key=await helloKey(sockets[0]);
  const duplicate=await ready();
  await act(async()=>{sockets[1].open();await vi.advanceTimersByTimeAsync(0);});
  expect(sockets[1].sent).toHaveLength(0); // No key is sent until ownership is verified.
  await act(()=>vi.advanceTimersByTimeAsync(1600));
  const other=sockets[1].sent[0].connectionKey;
  expect(other).toMatch(/^[0-9a-f-]{36}$/);expect(other).not.toBe(key);
  original.unmount();duplicate.unmount();delete navigator.locks;
});
it('an ended exam forgets the stored resume key',async()=>{
  installLocks();
  const hook=await ready();await helloKey(sockets[0]);
  expect(sessionStorage.getItem('oral-exam-resume:exam-1')).not.toBeNull();
  act(()=>sockets[0].message({type:'ended',session:{...snapshot(Date.now()),status:'completed'}}));
  expect(sessionStorage.getItem('oral-exam-resume:exam-1')).toBeNull();
  expect(sessionStorage.getItem('oral-exam-resume:exam-1:attempt')).toBeNull();
  hook.unmount();delete navigator.locks;
});
it('keeps retrying a busy lease until an orphaned connection must have been released',async()=>{
  const hook=await ready();
  // The first eight attempts meet a lease still renewed by the dropped connection.
  for(let i=0;i<8;i++){act(()=>{sockets.at(-1).open();sockets.at(-1).closed(4429,'Session unavailable');});act(()=>vi.advanceTimersByTime(8400));}
  expect(hook.result.current.state).toBe('connecting');
  welcome(sockets.at(-1));
  expect(hook.result.current.state).toBe('listening');expect(hook.result.current.error).toBe('');
  hook.unmount();
});
it('stops retrying a lease held by another live tab after the busy window',async()=>{
  const hook=await ready();
  for(let i=0;i<14;i++){act(()=>{sockets.at(-1)?.open();sockets.at(-1)?.closed(4429,'Session unavailable');});act(()=>vi.advanceTimersByTime(8400));}
  expect(hook.result.current.state).toBe('error');
  expect(hook.result.current.error).toMatch(/another tab or window/);
  hook.unmount();
});
it('numbers attempts in creation order, so a replaced socket that opens late sends the older number',async()=>{
  const hook=await ready();const older=sockets[0];
  act(()=>hook.result.current.connect(snapshot()));const newer=sockets[1];
  act(()=>newer.open());act(()=>older.open());
  expect(newer.sent[0].connectionAttempt).toBe(2);
  // The replaced socket is closed instead of sending a hello.
  expect(older.sent).toHaveLength(0);
  hook.unmount();
});

it('recovers a provider error even when its socket remains open, with a bounded retry budget',async()=>{
  const hook=await ready();
  for(let i=0;i<7;i++){
    const ws=sockets.at(-1);
    act(()=>{ws.open();ws.message({type:'welcome',session:snapshot(Date.now())});ws.message({type:'error',message:'Provider unavailable',retryable:true});});
    act(()=>vi.advanceTimersByTime(8500));
  }
  expect(sockets).toHaveLength(7);expect(hook.result.current.state).toBe('error');
  expect(hook.onSession.mock.calls.every(([s])=>s.expires_at===snapshot().expires_at)).toBe(true);
  expect(sockets.every(ws=>ws.sent[0].sessionId==='exam-1')).toBe(true);
  hook.unmount();
});

it('shows a generated acknowledgement separately from the next question and accepts closing without reconnect',async()=>{
  const hook=await ready();welcome(sockets[0]);
  act(()=>sockets[0].message({type:'question',question:'How would you apply it?',transition:'You identified the main idea clearly.',sequence:2}));
  expect(hook.result.current.question).toBe('How would you apply it?');expect(hook.result.current.remark).toEqual({kind:'transition',text:'You identified the main idea clearly.'});
  act(()=>sockets[0].message({type:'closing',text:'Thank you for taking part.'}));
  expect(hook.result.current.state).toBe('closing');expect(track.stop).toHaveBeenCalled();
  act(()=>sockets[0].message({type:'state',state:'ended'}));
  act(()=>sockets[0].message({type:'ended',session:{...snapshot(),status:'completed'}}));
  act(()=>vi.advanceTimersByTime(10000));expect(sockets).toHaveLength(1);expect(hook.onSession).toHaveBeenLastCalledWith(expect.objectContaining({status:'completed'}));hook.unmount();
});

it('does not invent a timeout when transport drops during a normal closing',async()=>{
  const hook=await ready();welcome(sockets[0]);hook.onSession.mockClear();
  act(()=>sockets[0].message({type:'closing',text:'Thank you for taking part.'}));
  act(()=>sockets[0].closed(1006,''));
  act(()=>vi.advanceTimersByTime(10000));
  expect(hook.result.current.state).toBe('ended');expect(sockets).toHaveLength(1);
  // The page's HTTP polling recovers the authoritative terminal snapshot.
  expect(hook.onSession).not.toHaveBeenCalled();hook.unmount();
});

it('keeps the question and microphone usable during TTS outage and clears the warning when audio recovers',async()=>{
  const hook=await ready();welcome(sockets[0]);const ws=sockets[0];
  act(()=>{ws.message({type:'question',question:'Explain routing.',sequence:1});ws.message({type:'audio_unavailable',sequence:1});ws.message({type:'state',state:'listening'});});
  expect(hook.result.current.question).toBe('Explain routing.');expect(hook.result.current.audioUnavailable).toBe(true);expect(hook.result.current.mic).toBe(true);expect(hook.result.current.error).toBe('');
  await act(async()=>{ws.message({type:'state',state:'speaking'});ws.message({type:'audio',sequence:2,audio:btoa('ID3fixture')});});
  expect(hook.result.current.audioUnavailable).toBe(false);expect(sockets).toHaveLength(1);expect(track.stop).not.toHaveBeenCalled();hook.unmount();
});
it('a resumed question clears the previous transition from the display',async()=>{
  const hook=await ready();welcome(sockets[0]);
  act(()=>sockets[0].message({type:'question',question:'Next question?',sequence:2,transition:'Let us continue.'}));
  expect(hook.result.current.remark?.text).toBe('Let us continue.');
  act(()=>sockets[0].closed());act(()=>vi.advanceTimersByTime(1100));welcome(sockets[1]);
  act(()=>sockets[1].message({type:'question',question:'Next question?',sequence:2,transition:''}));
  expect(hook.result.current.remark).toBeNull();expect(hook.result.current.question).toBe('Next question?');hook.unmount();
});
it('client decoding failure requests text fallback without disconnecting or blocking closing',async()=>{
  const hook=await ready();welcome(sockets[0]);const ws=sockets[0];
  const decode=vi.spyOn(Context.prototype,'decodeAudioData');
  decode.mockRejectedValue(new Error('Audio decode failed'));
  await act(async()=>{ws.message({type:'state',state:'speaking'});ws.message({type:'audio',sequence:1,audio:btoa('invalid')});});
  expect(ws.sent.at(-1)).toEqual({type:'playback_failed',sequence:1});expect(ws.readyState).toBe(1);
  act(()=>{ws.message({type:'audio_unavailable',sequence:1});ws.message({type:'state',state:'listening'});});
  expect(hook.result.current.state).toBe('listening');
  await act(async()=>{ws.message({type:'closing',text:'Thank you.'});ws.message({type:'audio',kind:'closing',audio:btoa('invalid')});});
  expect(ws.sent.at(-1)).toEqual({type:'played',kind:'closing'});decode.mockRestore();hook.unmount();
});
