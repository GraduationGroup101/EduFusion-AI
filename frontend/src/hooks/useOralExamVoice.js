import {useCallback,useEffect,useRef,useState} from 'react';
import {socketUrl} from '../services/oralExam';

export function useOralExamVoice(onSession) {
  const [state,setState]=useState('idle'),[error,setError]=useState(''),[mic,setMic]=useState(false),[muted,setMuted]=useState(false),[question,setQuestion]=useState(''),[remark,setRemark]=useState(null);
  const runtime=useRef({}),onSessionRef=useRef(onSession);onSessionRef.current=onSession;
  const stop=useCallback(()=>{
    const r=runtime.current;r.stopped=true;clearTimeout(r.retry);clearTimeout(r.deadline);clearTimeout(r.watchdog);r.socket?.close();r.source?.stop();
    r.stream?.getTracks().forEach(t=>t.stop());r.capture?.disconnect();r.input?.disconnect();r.context?.close().catch(()=>{});
    runtime.current={};setMic(false);
  },[]);
  useEffect(()=>()=>stop(),[stop]);
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
    r.sessionId=session.id;r.attempts=0;setError('');
    function deadline(snapshot){
      clearTimeout(r.deadline);
      const remaining=Math.max(0,new Date(snapshot.expires_at)-new Date(snapshot.server_now));
      r.deadline=setTimeout(()=>{r.phase='ended';r.source?.stop();r.stream?.getTracks().forEach(t=>t.stop());r.socket?.close();setState('ended');onSessionRef.current({...snapshot,status:'timed_out'});},remaining);
    }
    deadline(session);
    function dial(){
      if(r.stopped)return;
      setState('connecting');r.phase='connecting';
      const ws=new WebSocket(socketUrl());r.socket=ws;
      const watch=()=>{clearTimeout(r.watchdog);r.watchdog=setTimeout(()=>ws.close(),20000);};watch();
      ws.onopen=()=>ws.send(JSON.stringify({type:'hello',token:localStorage.getItem('token'),sessionId:r.sessionId}));
      ws.onmessage=async event=>{
        if(r.stopped||r.socket!==ws)return;
        try{
          const msg=JSON.parse(event.data);watch();
          if(msg.type==='welcome'){r.attempts=0;setError('');onSessionRef.current(msg.session);deadline(msg.session);}
          if(msg.type==='clock'){onSessionRef.current({id:r.sessionId,...msg});}
          if(msg.type==='state'){r.phase=msg.state;setState(msg.state);}
          // A conversational reply (repeat, clarification, nudge, retry) keeps the
          // same question and sequence; the remark is what the examiner just said.
          if(msg.type==='question'){setQuestion(msg.question);setRemark(msg.kind&&msg.kind!=='question'?{kind:msg.kind,text:msg.remark||''}:null);}
          if(msg.type==='error'){setError(msg.message);r.phase='error';setState('error');r.source?.stop();}
          if(msg.type==='ended'){r.phase='ended';setState('ended');onSessionRef.current(msg.session);stop();}
          if(msg.type==='audio'){
            const buffer=Uint8Array.from(atob(msg.audio),c=>c.charCodeAt(0)).buffer;
            const decoded=await r.context.decodeAudioData(buffer);
            if(r.stopped||r.socket!==ws||r.phase!=='speaking')return;
            await r.context.resume();
            if(r.stopped||r.socket!==ws)return;
            if(r.context.state!=='running')throw new Error('Audio playback is blocked');
            r.source=r.context.createBufferSource();r.source.buffer=decoded;r.source.connect(r.context.destination);
            r.source.onended=()=>{if(!r.stopped&&r.phase==='speaking'&&ws.readyState===1)ws.send(JSON.stringify({type:'played',sequence:msg.sequence}));};
            r.source.start();
          }
        }catch{if(!r.stopped){setError('Audio could not play. Reconnect to hear the question again.');setState('error');r.phase='error';}}
      };
      ws.onerror=()=>{};
      ws.onclose=event=>{
        clearTimeout(r.watchdog);r.source?.stop();
        if(r.stopped||r.phase==='ended')return;
        if(r.deviceLost){r.phase='error';setState('error');return;}
        r.phase='reconnecting';setState('reconnecting');
        if([4401,4403,4409].includes(event.code)||r.attempts>=6){setError('Connection lost. Close other exam tabs, then reconnect. The exam timer continues.');setState('error');return;}
        r.retry=setTimeout(dial,Math.min(8000,750*2**r.attempts++)+Math.random()*300);
      };
    }
    dial();
  },[stop]);
  const toggleMute=()=>{const r=runtime.current;r.muted=!r.muted;setMuted(r.muted);r.stream?.getAudioTracks().forEach(t=>{t.enabled=!r.muted;});};
  return {state,error,mic,muted,question,remark,checkMic,connect,stop,toggleMute};
}
