import {useCallback,useEffect,useRef,useState} from 'react';
import {socketUrl} from '../services/oralExam';
import {oralLifecycle} from '../services/oralExamDiagnostics';
import {claimResumeKey,forgetResumeKey,nextResumeAttempt} from '../services/oralExamResume';

// The server keeps an orphaned connection's lease for up to ~35 s (pong watchdog)
// or 20 s after its process stops. A busy lease is retried for longer than that.
const LEASE_BUSY_WINDOW_MS=60000;

export function useOralExamVoice(onSession) {
  const [state,setState]=useState('idle'),[error,setError]=useState(''),[mic,setMic]=useState(false),[muted,setMuted]=useState(false),[question,setQuestion]=useState(''),[remark,setRemark]=useState(null);
  const runtime=useRef({}),onSessionRef=useRef(onSession);onSessionRef.current=onSession;
  // A per-tab capability: survives a refresh of this tab, never shared with another live tab.
  const resume=useRef({});
  const stop=useCallback(()=>{
    const r=runtime.current;r.stopped=true;clearTimeout(r.retry);clearTimeout(r.deadline);clearTimeout(r.closingDeadline);clearTimeout(r.watchdog);r.socket?.close();r.source?.stop();
    r.stream?.getTracks().forEach(t=>t.stop());r.capture?.disconnect();r.input?.disconnect();r.context?.close().catch(()=>{});
    runtime.current={};setMic(false);
  },[]);
  useEffect(()=>()=>{stop();resume.current.claim?.release();resume.current={};},[stop]);
  const checkMic=useCallback(async()=>{
    stop();setError('');
    const r={stopped:false,muted:false};runtime.current=r;setMuted(false);
    try {
      if(!navigator.mediaDevices?.getUserMedia)throw new Error('Use a supported browser over HTTPS to access your microphone.');
      r.stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});
      if(r.stopped){r.stream.getTracks().forEach(t=>t.stop());return false;}
      r.context=new AudioContext({sampleRate:16000});await r.context.resume();
      if(r.context.sampleRate!==16000)throw new Error('This browser cannot capture the required audio format. Try Chrome or Edge.');
      await r.context.audioWorklet.addModule('/oral-exam-capture.js');
      if(r.stopped){await r.context.close();return false;}
      r.input=r.context.createMediaStreamSource(r.stream);r.capture=new AudioWorkletNode(r.context,'oral-exam-capture');
      const gain=r.context.createGain();gain.gain.value=0;r.input.connect(r.capture);r.capture.connect(gain);gain.connect(r.context.destination);
      r.capture.port.onmessage=({data})=>{
        if(!r.stopped&&!r.muted&&r.phase==='listening'&&r.socket?.readyState===1&&r.socket.bufferedAmount<32000)r.socket.send(data);
      };
      r.stream.getAudioTracks().forEach(t=>{t.onended=()=>{if(!r.stopped){r.deviceLost=true;setMic(false);setState('error');setError('The microphone disconnected. Check the device and reconnect.');r.socket?.close();}};});
      setMic(true);return true;
    }catch(e){stop();setError(e.name==='NotAllowedError'?'Microphone permission was denied. Allow access in your browser and try again.':e.name==='NotFoundError'?'No microphone was found. Connect one and try again.':e.message||'Unable to access the microphone.');return false;}
  },[stop]);
  const connect=useCallback(session=>{
    const r=runtime.current;if(!r.context||r.stopped)return;
    clearTimeout(r.retry);clearTimeout(r.watchdog);
    const previous=r.socket;r.socket=null;previous?.close();r.source?.stop();
    r.connectionGeneration=(r.connectionGeneration||0)+1;
    const generation=r.connectionGeneration;
    const active=()=>runtime.current===r&&!r.stopped&&r.connectionGeneration===generation&&r.phase!=='ended';
    if(resume.current.sessionId!==session.id){resume.current.claim?.release();resume.current={sessionId:session.id,claim:claimResumeKey(session.id)};}
    r.sessionId=session.id;r.attempts=0;r.busySince=null;setError('');
    function deadline(snapshot){
      clearTimeout(r.deadline);
      const remaining=Math.max(0,new Date(snapshot.expires_at)-new Date(snapshot.server_now));
      r.deadline=setTimeout(()=>{
        if(!active())return;r.timeExpired=true;r.phase='closing';setState('closing');clearTimeout(r.retry);clearTimeout(r.watchdog);r.source?.stop();r.stream?.getTracks().forEach(t=>t.stop());setMic(false);
        setRemark({kind:'closing',text:session.language==='ar'?'انتهى وقت المقابلة. شكرًا إلك وبالتوفيق.':'The interview time has ended. Thank you, and best of luck.'});
        // Capture stops at zero; a bounded grace period is only for closing
        // audio/report delivery, never for accepting another answer.
        r.closingDeadline=setTimeout(()=>{if(!active())return;r.phase='ended';setState('ended');onSessionRef.current({...snapshot,status:'timed_out'});stop();},8000);
      },remaining);
    }
    deadline(session);
    function dial(){
      if(!active())return;
      setState('connecting');r.phase='connecting';
      const ws=new WebSocket(socketUrl()),instance=crypto.randomUUID();r.socket=ws;
      // Numbered when the socket is created, so the server can refuse a delayed older handshake.
      const attempt=nextResumeAttempt(r.sessionId);
      const current=()=>active()&&r.socket===ws;
      const log=(event,fields={})=>oralLifecycle(event,{session:r.sessionId,connection:instance,...fields});
      log('connect',{attempt:r.attempts,connection_attempt:attempt});
      function disconnected(code,reason,retryAfterMs=0){
        if(!current())return;
        clearTimeout(r.watchdog);r.socket=null;r.source?.stop();
        if(r.phase==='closing'){r.phase='ended';setState('ended');if(r.timeExpired)onSessionRef.current({...session,status:'timed_out'});stop();return;}
        log('disconnect',{code,reason});
        if(r.deviceLost){r.phase='error';setState('error');return;}
        r.phase='reconnecting';setState('reconnecting');
        // A busy lease is usually this tab's own orphaned connection: keep retrying
        // until the server has certainly released it, not just six times.
        if(code===4429&&r.busySince==null)r.busySince=Date.now();
        const waitingForLease=code===4429&&Date.now()-r.busySince<LEASE_BUSY_WINDOW_MS;
        if([4001,4401,4403,4409].includes(code)||(r.attempts>=6&&!waitingForLease)){
          setError(code===4401?'Your sign-in expired. Sign in again to recover your exam.':[4001,4409].includes(code)?'Another connection now owns this exam. Close other exam tabs, then reconnect. The timer continues.':code===4429?'This exam is still connected in another tab or window. Close it, then reconnect. The timer continues.':'Connection lost. Reconnect to recover your exam. The timer continues.');setState('error');return;
        }
        const delay=Math.max(Math.min(600000,Math.max(0,Number(retryAfterMs)||0)),Math.min(8000,750*2**r.attempts++))+Math.random()*300;
        log('reconnect',{attempt:r.attempts,delay_ms:Math.round(delay)});
        r.retry=setTimeout(dial,delay);
      }
      const watch=()=>{clearTimeout(r.watchdog);r.watchdog=setTimeout(()=>{
        if(!current())return;
        log('watchdog');disconnected(4000,'heartbeat_timeout');ws.close(4000,'Heartbeat timeout');
      },20000);};watch();
      ws.onopen=()=>{
        if(!current()){ws.close();return;}
        const claim=resume.current.claim;
        const hello=key=>{if(current()&&ws.readyState===1)ws.send(JSON.stringify({type:'hello',token:localStorage.getItem('token'),sessionId:r.sessionId,connectionKey:key,connectionAttempt:attempt}));};
        // The key is verified against other live tabs before it is ever sent.
        if(claim.key)hello(claim.key);else claim.ready.then(hello);
      };
      ws.onmessage=async event=>{
        if(!current())return;
        try{
          const msg=JSON.parse(event.data);watch();
          if(r.timeExpired&&(msg.type==='question'||msg.type==='state'&&!['closing','ended'].includes(msg.state)||msg.type==='audio'&&msg.kind!=='closing'))return;
          if(msg.type==='welcome'){r.busySince=null;setError('');log('welcome',{server_connection:msg.connectionId});onSessionRef.current(msg.session);deadline(msg.session);}
          if(msg.type==='clock'){onSessionRef.current({id:r.sessionId,...msg});}
          // The terminal snapshot follows the ended phase message. Keep this
          // socket eligible until that snapshot has actually been consumed.
          if(msg.type==='state'&&msg.state!=='ended'){r.phase=msg.state;setState(msg.state);if(msg.state==='listening')r.attempts=0;}
          // A conversational reply (repeat, clarification, nudge, retry) keeps the
          // same question and sequence; the remark is what the examiner just said.
          if(msg.type==='question'){setQuestion(msg.question);setRemark(msg.transition?{kind:'transition',text:msg.transition}:msg.kind&&msg.kind!=='question'?{kind:msg.kind,text:msg.remark||''}:null);}
          if(msg.type==='closing'){r.phase='closing';setState('closing');clearTimeout(r.retry);clearTimeout(r.deadline);r.stream?.getTracks().forEach(t=>t.stop());setMic(false);setRemark({kind:'closing',text:msg.text});}
          if(msg.type==='error'){setError(msg.message);r.phase='error';setState('error');r.source?.stop();if(msg.retryable){disconnected(4500,'recoverable_exam_failure',msg.retry_after_ms);ws.close(4500,'Recoverable exam failure');}}
          if(msg.type==='ended'){r.phase='ended';forgetResumeKey(r.sessionId);setState('ended');onSessionRef.current(msg.session);stop();}
          if(msg.type==='audio'){
            const buffer=Uint8Array.from(atob(msg.audio),c=>c.charCodeAt(0)).buffer;
            const decoded=await r.context.decodeAudioData(buffer);
            if(!current()||!['speaking','closing'].includes(r.phase))return;
            await r.context.resume();
            if(!current())return;
            if(r.context.state!=='running')throw new Error('Audio playback is blocked');
            r.source=r.context.createBufferSource();r.source.buffer=decoded;r.source.connect(r.context.destination);
            r.source.onended=()=>{if(current()&&['speaking','closing'].includes(r.phase)&&ws.readyState===1)ws.send(JSON.stringify({type:'played',sequence:msg.sequence,kind:msg.kind}));};
            r.source.start();
          }
        }catch{if(current()){log('playback_failure');setError('Audio could not play. Reconnect to hear the question again.');setState('error');r.phase='error';}}
      };
      ws.onerror=()=>{};
      ws.onclose=event=>disconnected(event.code,event.reason);
    }
    dial();
  },[stop]);
  const toggleMute=()=>{const r=runtime.current;r.muted=!r.muted;setMuted(r.muted);r.stream?.getAudioTracks().forEach(t=>{t.enabled=!r.muted;});};
  return {state,error,mic,muted,question,remark,checkMic,connect,stop,toggleMute};
}
