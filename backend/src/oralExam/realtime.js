const {WebSocketServer}=require('ws');
const {randomUUID}=require('node:crypto');
const jwt=require('jsonwebtoken');
const {getAllowedOrigins}=require('../lib/corsOrigins');
const queries=require('../db/queries');
const db=require('../db');
const store=require('./store');
const examiner=require('./examiner');
const voice=require('./voice');
const {id}=require('./contracts');
const {configured}=require('./config');
const {lifecycle}=require('./diagnostics');

async function authenticate(token) {
  const claims=jwt.verify(token,process.env.JWT_SECRET);
  const user=Object.hasOwn(claims,'id_student')?await queries.getStudentUserById(claims.id_student):await queries.getUserById(claims.id);
  if(!user?.is_active)throw new Error('Unauthenticated');
  return {user,expires:claims.exp*1000};
}

function attachRealtime(server,dependencies={}) {
  const auth=dependencies.authenticate||authenticate,model=dependencies.examiner||examiner,audio=dependencies.voice||voice;
  const connections=new Map();
  const wss=new WebSocketServer({noServer:true,maxPayload:12000,perMessageDeflate:false});
  const origins=getAllowedOrigins();
  server.on('upgrade',(req,socket,head)=>{
    if(req.url!=='/api/oral-exam/realtime'||!configured()||!origins.has(req.headers.origin)||wss.clients.size>=100){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;}
    wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws));
  });
  wss.on('connection',ws=>{
    const connection=randomUUID(),connectedAt=Date.now();
    let user,session,token,stt,phase='hello',busy=false,closed=false,heartbeat,expiry,playbackTimer,authExpiry;
    let bytes=0,windowStart=Date.now(),lastPong=Date.now(),generation=0;
    const abort=new AbortController();
    const log=(event,fields={})=>lifecycle(event,{session:session?.id,connection,phase,...fields});
    log('connect');
    const helloTimer=setTimeout(()=>ws.close(4408,'Connection timed out'),10000);
    const send=data=>{if(ws.readyState!==1)return;if(ws.bufferedAmount>3*1024*1024){ws.close(4503,'Connection too slow');return;}ws.send(JSON.stringify(data));};
    const state=value=>{phase=value;send({type:'state',state:value});};
    function stopAudio(){generation++;stt?.close();stt=null;clearTimeout(playbackTimer);}
    function error(message){stopAudio();state('error');send({type:'error',message});}
    async function lostLease() {
      const saved=await store.get(user,session.id);
      if(closed)return;
      if(saved.status==='active'){
        const otherOwner=saved.lease_token&&saved.lease_token!==token&&new Date(saved.lease_until)>new Date(saved.server_now);
        log(otherOwner?'ownership_conflict':'lease_expired',{status:saved.status});
        stopAudio();abort.abort();
        ws.close(otherOwner?4409:4500,otherOwner?'Exam connected elsewhere':'Connection lease expired');return;
      }
      log('expired_session',{status:saved.status});
      stopAudio();state('ended');abort.abort();send({type:'ended',session:store.publicView(saved)});ws.close(1000);
      await model.evaluate(user,session.id);
    }
    async function finish(reason='exam_completed') {
      if(closed||phase==='ended')return;
      stopAudio();state('ended');abort.abort();clearTimeout(expiry);
      const saved=await store.finish(user,session.id,reason,token);
      if(saved.status==='active'){ws.close(4001,'Connection resumed');return;}
      send({type:'ended',session:store.publicView(saved)});
      ws.close(1000,'Exam ended');
      await model.evaluate(user,session.id);
    }
    async function listen() {
      if(closed||abort.signal.aborted)return;
      stopAudio();const current=generation;
      state('connecting_audio');
      stt=audio.transcriber({language:session.language,signal:abort.signal,
        onPartial:()=>{}, // Keep interim speech ephemeral; the UI stays conversational.
        onError:()=>{if(current===generation&&!closed&&!abort.signal.aborted){log('provider_failure',{stage:'stt'});error('Microphone transcription is unavailable. Reconnect to retry.');}},
        onFinal:text=>{if(current===generation&&phase==='listening')advance(text).catch(err=>{log('provider_failure',{stage:'answer',error_class:err.name});if(!closed&&!abort.signal.aborted)error('Your answer could not be processed. Reconnect to recover your saved progress.');});},
      });
      await stt.opened;
      if(current===generation&&!closed)state('listening');
    }
    async function speakQuestion() {
      const current=++generation;
      state('thinking');
      const question=session.turns.at(-1);
      send({type:'question',question:question.question,sequence:question.sequence});
      const introduction=session.turns.length===1?(session.language==='ar'?'مرحباً. سنجري امتحاناً شفهياً قصيراً بناءً على مادتك. ':'Welcome. We will explore your material in a short oral exam. '):'';
      try {
        const data=await audio.speak(introduction+question.question,session.language,abort.signal);
        if(closed||abort.signal.aborted||current!==generation)return;
        state('speaking');
        send({type:'audio',audio:data.toString('base64'),sequence:question.sequence});
        playbackTimer=setTimeout(()=>{if(phase==='speaking')error('Audio playback did not finish. Reconnect to retry.');},60000);
      }catch(err) {if(!abort.signal.aborted){log('provider_failure',{stage:'tts',error_class:err.name});error('The examiner’s audio could not play. Reconnect to hear the question again.');}}
    }
    async function advance(transcript) {
      if(busy||closed||abort.signal.aborted)return;
      busy=true;stopAudio();state('thinking');
      try {
        const live=await store.renew(session.id,token);
        if(!live){await lostLease();return;}
        session=await store.get(user,session.id);
        if(transcript!==null)await store.recordAnswer(session.id,token,session.turns.at(-1).sequence,transcript);
        const decision=await model.next(session,transcript,abort.signal);
        if(abort.signal.aborted||closed)return;
        await store.commit(session.id,token,session.turns.at(-1)?.sequence||0,transcript,decision);
        session=await store.get(user,session.id);
        if(!decision.next){await finish();return;}
        await speakQuestion();
      } finally {busy=false;}
    }
    ws.on('pong',()=>{lastPong=Date.now();});
    ws.on('message',(raw,binary)=>{
      (async()=>{
        if(closed||abort.signal.aborted)return;
        if(Date.now()-windowStart>=1000){bytes=0;windowStart=Date.now();}
        bytes+=raw.length;
        if(bytes>100000){ws.close(4429,'Audio rate exceeded');return;}
        if(binary){if(phase==='listening'&&raw.length<=6400&&raw.length%2===0){if(!stt?.send(raw))error('Audio connection was interrupted. Reconnect to continue.');}return;}
        const msg=JSON.parse(raw.toString());
        if(phase==='hello') {
          phase='authenticating';
          if(msg.type!=='hello'||typeof msg.token!=='string'||msg.token.length>8000)throw new Error('Invalid handshake');
          const sessionId=id.parse(msg.sessionId);
          const clientId=msg.connectionKey==null?null:id.parse(msg.connectionKey);
          // A capability must number its attempts so the newest one always wins.
          const attempt=clientId?msg.connectionAttempt:null;
          if(clientId&&!(Number.isSafeInteger(attempt)&&attempt>=1&&attempt<=2147483647))throw new Error('Invalid handshake');
          const identity=await auth(msg.token);
          if(closed)return;
          user=identity.user;
          session=await store.get(user,sessionId);
          if(session.status!=='active'){send({type:'ended',session:store.publicView(session)});ws.close(1000);return;}
          const lease=await store.claim(user,sessionId,clientId,attempt);token=lease.token;
          if(closed){await store.release(sessionId,token);return;}
          // Retire a resumed local socket immediately, including provider work.
          // On another process the database token still fences every old write.
          const previous=connections.get(sessionId);
          if(previous){previous.dispose();previous.ws.close(4001,'Connection resumed');}
          connections.set(sessionId,{ws,token,dispose});
          log(previous?'reconnect':'claim');
          // Read again only after fencing. A completed old turn could otherwise
          // be missed between the first read and the atomic ownership change.
          session=await store.get(user,sessionId);
          if(closed)return;
          clearTimeout(helloTimer);
          const remaining=Math.max(0,new Date(session.expires_at)-new Date(session.server_now));
          expiry=setTimeout(()=>{stopAudio();abort.abort();finish('time_limit').catch(()=>ws.close(4500,'Exam ended'));},remaining);
          if(Number.isFinite(identity.expires))authExpiry=setTimeout(()=>ws.close(4401,'Sign in again'),Math.max(0,identity.expires-Date.now()));
          let renewing=false;
          heartbeat=setInterval(async()=>{
            if(renewing||closed)return;renewing=true;
            try{
              if(Date.now()-lastPong>30000){log('watchdog',{pong_age_ms:Date.now()-lastPong});ws.terminate();return;}
              const live=await store.renew(session.id,token);
              if(closed)return;
              if(!live){await lostLease();return;}
              if(process.env.ORAL_EXAM_DIAGNOSTICS==='true')log('heartbeat',{pong_age_ms:Date.now()-lastPong,lease_remaining_ms:new Date(live.lease_until)-new Date(live.server_now)});
              send({type:'clock',expires_at:live.expires_at,server_now:live.server_now});ws.ping();
            }catch(err){log('heartbeat_failure',{error_class:err.name});ws.close(4500,'Connection unavailable');}finally{renewing=false;}
          },5000);
          send({type:'welcome',session:store.publicView(session),connectionId:connection});
          log('welcome',{auth_remaining_seconds:Number.isFinite(identity.expires)?Math.floor((identity.expires-Date.now())/1000):undefined});
          if(!session.turns.length)await advance(null);
          else if(session.turns.at(-1).transcript&&!session.turns.at(-1).assessment)await advance(session.turns.at(-1).transcript);
          else await speakQuestion();
        }else if(msg.type==='played'&&phase==='speaking'&&msg.sequence===session.turns.at(-1)?.sequence){clearTimeout(playbackTimer);await listen();}
        else if(msg.type==='end'&&user&&session)await finish('student_ended');
        else if(msg.type==='hello')ws.close(4400,'Repeated handshake');
      })().catch(err=>{
        console.error('Oral exam connection failed:',examiner.diagnostic('connection',err,0));
        log(err.statusCode===409?'ownership_conflict':'connection_failure',{error_class:err.name});
        if(!user||!token){
          send({type:'error',message:err.statusCode===409?'This exam is connected elsewhere. Retrying shortly; the timer continues.':'Unable to connect to this exam. Sign in and retry.'});
          ws.close(err.statusCode===409?4429:4403,'Session unavailable');
        }
        else if(!abort.signal.aborted)error('The exam connection failed. Reconnect to continue with the same timer.');
      });
    });
    ws.on('error',()=>{});
    function dispose(){
      if(closed)return;
      closed=true;abort.abort();stopAudio();clearTimeout(helloTimer);clearTimeout(expiry);clearTimeout(authExpiry);clearInterval(heartbeat);
      if(token&&session){
        if(connections.get(session.id)?.token===token)connections.delete(session.id);
        store.release(session.id,token).then(()=>log('release')).catch(err=>log('release_failure',{error_class:err.name}));
      }
    }
    ws.on('close',(code)=>{
      // Peer close reasons are arbitrary input; log the code and known server
      // meaning rather than possibly recording student content or a secret.
      const reasons={1000:'normal',1006:'transport_lost',4001:'resumed',4401:'authentication_expired',4403:'connection_rejected',4409:'ownership_conflict',4429:'lease_busy',4500:'connection_unavailable'};
      log('disconnect',{code,reason:reasons[code]||'closed',elapsed_ms:Date.now()-connectedAt});
      dispose();
    });
  });
  // Restarts and disconnected clients cannot postpone the stored deadline. A
  // bounded sweep also retries final reports without keeping a browser alive.
  let sweeping=false;
  const sweep=setInterval(async()=>{
    if(sweeping||!configured())return;sweeping=true;
    try {
      await store.expire();
      const pending=(await db.query("SELECT id,id_student,user_id FROM edufusion_oral_exam_sessions WHERE status IN ('completed','timed_out') AND evaluation_status='pending' ORDER BY ended_at LIMIT 4")).rows;
      for(const row of pending)await model.evaluate(row.id_student==null?{id:row.user_id}:{id_student:row.id_student},row.id);
    }catch(err){console.error('Oral exam finalization failed:',err.code||err.name);}finally{sweeping=false;}
  },5000);
  sweep.unref();
  return {close(){clearInterval(sweep);for(const client of wss.clients)client.terminate();wss.close();},wss};
}
module.exports={attachRealtime,authenticate};
