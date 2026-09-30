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
  expect(hook.result.current.state).toBe('ended');expect(track.stop).toHaveBeenCalled();
  hook.unmount();
});
it('reconnects a server-side close with a private resume credential and the same session',async()=>{
  const hook=await ready();welcome(sockets[0]);
  const connectionKey=sockets[0].sent[0].connectionKey;
  act(()=>sockets[0].closed(4500,'Connection unavailable'));
  act(()=>vi.advanceTimersByTime(1100));
  expect(sockets).toHaveLength(2);act(()=>sockets[1].open());
  expect(sockets[1].sent[0]).toMatchObject({type:'hello',sessionId:'exam-1',connectionKey});
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
