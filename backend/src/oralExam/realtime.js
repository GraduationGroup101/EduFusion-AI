const {WebSocketServer}=require('ws');
const {randomUUID}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const jwt=require('jsonwebtoken');
const {getAllowedOrigins}=require('../lib/corsOrigins');
const queries=require('../db/queries');
const store=require('./store');
const examiner=require('./examiner');
const conversation=require('./conversation');
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
    let user,session,token,stt,phase='hello',busy=false,closed=false,heartbeat,expiry,playbackTimer,authExpiry,closingWork,closingPlayed;
    let bytes=0,windowStart=Date.now(),lastPong=Date.now(),generation=0;
    const abort=new AbortController();
    const log=(event,fields={})=>lifecycle(event,{session:session?.id,connection,phase,...fields});
    log('connect');
    const helloTimer=setTimeout(()=>ws.close(4408,'Connection timed out'),10000);
    const send=data=>{if(ws.readyState!==1)return;if(ws.bufferedAmount>3*1024*1024){ws.close(4503,'Connection too slow');return;}ws.send(JSON.stringify(data));};
    const state=value=>{phase=value;send({type:'state',state:value});};
    function stopAudio(){generation++;stt?.close();stt=null;clearTimeout(playbackTimer);}
    const details=err=>({error_class:typeof err?.name==='string'&&/^[A-Za-z]{1,40}$/.test(err.name)?err.name:'Error',provider_status:Number.isInteger(err?.status)?err.status:undefined,provider_code:typeof err?.code==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(err.code)?err.code:undefined});
    function closeFailure(stage,err,reason){log('closing_failure',{stage,code:4500,...details(err)});ws.close(4500,reason);}
    function error(message,retryAfterMs=0,err,stage='audio'){
      if(closingWork)return;stopAudio();state('error');
      if(session&&token)store.interruption(session.id,token,'provider_failure').catch(()=>{});
      // Exhausted generation stays explicitly failed but connected: another
      // handshake cannot repair a persistent provider/configuration rejection.
      const reconnect=!err?.generationFailure;
      send({type:'error',message,retryable:reconnect,retry_after_ms:retryAfterMs});
      if(reconnect)closeFailure(stage,err,'Recoverable exam failure');
    }
    async function generate(stage,work){
      for(let attempt=1;attempt<=2;attempt++){
        try{return await work();}
        catch(err){
          if(closed||abort.signal.aborted)throw err;
          const transient=['TimeoutError','SyntaxError','ZodError','ModelValidationError'].includes(err.name)||err instanceof TypeError||[408,429].includes(err.status)||err.status>=500||err.status===400&&err.code==='json_validate_failed';
          const waitMs=Math.max(150,err.retryAfterMs||150);
          log('generation_failure',{stage,attempt,...details(err)});
          if(!transient||attempt===2||waitMs>60000||Date.now()+waitMs+15000>=new Date(session.expires_at).getTime()){
            err.generationFailure=transient||err.name==='ProviderError';throw err;
          }
          state('thinking');await delay(waitMs,undefined,{signal:abort.signal});
          if(closed||abort.signal.aborted)throw new DOMException('Aborted','AbortError');
          if(!await store.renew(session.id,token)){await lostLease();throw new DOMException('Lease lost','AbortError');}
          session=await store.get(user,session.id);
        }
      }
    }
    async function lostLease() {
      const saved=await store.get(user,session.id);
      if(closed)return;
      if(saved.status==='active'){
        const otherOwner=saved.lease_token&&saved.lease_token!==token&&new Date(saved.lease_until)>new Date(saved.server_now);
        log(otherOwner?'ownership_conflict':'lease_expired',{status:saved.status,stage:'lease',code:otherOwner?4409:4500,error_class:'LeaseError'});
        stopAudio();abort.abort();
        ws.close(otherOwner?4409:4500,otherOwner?'Exam connected elsewhere':'Connection lease expired');return;
      }
      log('expired_session',{status:saved.status});
      await finish(saved.termination_reason||'time_limit');
    }
    async function finish(reason='exam_completed') {
      if(closingWork)return closingWork;
      if(closed||phase==='ended')return;
      closingWork=(async()=>{
        stopAudio();abort.abort();clearTimeout(expiry);clearInterval(heartbeat);
        const saved=await store.finish(user,session.id,reason,token);
        if(saved.status==='active'){ws.close(4001,'Connection resumed');return;}
        const completed=await store.ensureCore(user,session.id);
        state('closing');const text=conversation.closing(session.language);send({type:'closing',text});
        log('closing',{reason:completed.termination_reason});
        model.evaluate(user,session.id).catch(err=>log('evaluation_failure',{error_class:err.name}));
        const controller=new AbortController();
        let timeout;
        try{
          await Promise.race([new Promise(resolve=>{timeout=setTimeout(resolve,dependencies.closingTimeoutMs??6000);}),
            (async()=>{const data=await audio.speak(text,session.language,controller.signal);if(closed)return;
              const played=new Promise(resolve=>{closingPlayed=resolve;});
              send({type:'audio',audio:data.toString('base64'),kind:'closing'});await played;})()]);
        }catch(err){log('closing_audio_unavailable',audio.diagnostic?.(err)||{error_class:err.name});}
        finally{clearTimeout(timeout);controller.abort();closingPlayed=null;}
        if(!closed){state('ended');send({type:'ended',session:store.publicView(await store.get(user,session.id))});ws.close(1000,'Exam ended');}
      })();
      return closingWork;
    }
    async function listen() {
      if(closed||abort.signal.aborted)return;
      stopAudio();const current=generation;
      state('connecting_audio');
      stt=audio.transcriber({language:session.language,signal:abort.signal,
        onPartial:()=>{}, // Keep interim speech ephemeral; the UI stays conversational.
        onError:()=>{if(current===generation&&!closed&&!abort.signal.aborted){log('provider_failure',{stage:'stt'});error('Microphone transcription is unavailable. Reconnect to retry.');}},
        onFinal:text=>{if(current===generation&&phase==='listening')advance(text).catch(err=>{log('provider_failure',{stage:'answer',...details(err)});if(!closed&&!abort.signal.aborted)error('Your answer could not be processed. Your saved progress and timer are preserved.',err.retryAfterMs,err,'answer');});},
      });
      await stt.opened;
      if(current===generation&&!closed)state('listening');
    }
    // Speaks the current question, or a conversational reply about it. The
    // `question` event always carries the persisted question and sequence; a
    // repeat re-reads it, while a clarification, nudge or retry prompt is
    // spoken on its own and shown as the examiner's remark.
    async function speakQuestion(kind='question',remark='',resuming=false) {
      const current=++generation;
      state('thinking');
      const question=session.turns.at(-1);
      // Keep the saved acknowledgement for review, but never replay it on resume.
      const transition=kind==='question'&&!resuming?question.transition||'':'';
      send({type:'question',question:question.question,sequence:question.sequence,kind,remark,transition});
      const introduction=!resuming&&session.turns.length===1&&kind==='question'?(session.language==='ar'?'مرحباً. سنجري امتحاناً شفهياً قصيراً بناءً على مادتك. ':'Welcome. We will explore your material in a short oral exam. '):'';
      const text=kind==='question'?introduction+(transition?transition+' ':'')+question.question:conversation.spoken(kind,remark,question.question);
      try {
        const data=await audio.speak(text,session.language,abort.signal);
        if(closed||abort.signal.aborted||current!==generation)return;
        state('speaking');
        send({type:'audio',audio:data.toString('base64'),sequence:question.sequence});
        playbackTimer=setTimeout(()=>{if(phase==='speaking')textFallback('playback_timeout').catch(()=>error('Microphone transcription is unavailable. Reconnect to retry.'));},60000);
      }catch(err) {
        if(closed||abort.signal.aborted||current!==generation)return;
        log('provider_failure',{stage:'tts',...(audio.diagnostic?.(err)||{error_class:err.name})});
        await textFallback('tts_unavailable');
      }
    }
    async function textFallback(reason){
      if(closed||abort.signal.aborted||closingWork)return;
      stopAudio();state('connecting_audio');
      log('audio_unavailable',{reason});
      await store.interruption(session.id,token,reason);
      if(closed||abort.signal.aborted||closingWork)return;
      send({type:'audio_unavailable',sequence:session.turns.at(-1)?.sequence});
      // TTS is optional; the persisted question and STT remain usable.
      await listen();
    }
    // Handles a non-answer utterance: nothing is scored, no question is
    // consumed, and the exchange is stored on the current turn for the review.
    async function converse(intent,transcript,modelReply=null) {
      const turn=session.turns.at(-1);
      let text=modelReply;
      if(text===null&&['clarify','dont_know'].includes(intent)&&typeof model.reply==='function') {
        try {text=(await model.reply(session,transcript,intent,abort.signal)).reply;}
        catch(err) {if(abort.signal.aborted||closed)return;console.error('Oral exam reply failed:',examiner.diagnostic('conversation_reply',err,0));}
      }
      if(abort.signal.aborted||closed)return;
      const kind=conversation.KIND[intent];
      const exchange=await store.recordExchange(session.id,token,turn.sequence,{kind,transcript,reply:conversation.reply(intent,session.language,turn.question,text)});
      session=await store.get(user,session.id);
      await speakQuestion(kind,exchange.reply);
    }
    async function advance(transcript) {
      if(busy||closed||abort.signal.aborted)return;
      busy=true;stopAudio();state('thinking');
      try {
        const live=await store.renew(session.id,token);
        if(!live){await lostLease();return;}
        session=await store.get(user,session.id);
        const turn=session.turns.at(-1);
        // Obvious control phrases are handled without the model; everything
        // else is classified by the examiner as part of its decision.
        const heard=transcript===null?null:conversation.classify(transcript);
        const intent=transcript===null?'answer':conversation.resolve(heard,turn?.exchanges);
        if(intent!=='answer'){await converse(intent,transcript);return;}
        // A recognised request past its allowance is the answer of record: the
        // model is told so and must assess it rather than answer with a reply.
        let forceAnswer=transcript!==null&&heard!==null;
        if(transcript!==null)await store.recordAnswer(session.id,token,turn.sequence,transcript);
        let decision=await generate(transcript===null?'initial_question':'assessment',()=>model.next(session,transcript,abort.signal,{forceAnswer}));
        if(abort.signal.aborted||closed)return;
        if(transcript!==null&&decision.intent&&decision.intent!=='answer') {
          const modelIntent=conversation.resolve(decision.intent,turn?.exchanges);
          if(modelIntent!=='answer'){await converse(modelIntent,transcript,decision.reply??null);return;}
          if(forceAnswer)throw new Error('Exhausted control request was not assessed');
          // The model classified a request whose allowance is used up: ask again
          // for an assessment. A control decision is never committed as an answer.
          forceAnswer=true;
          decision=await generate('assessment',()=>model.next(session,transcript,abort.signal,{forceAnswer}));
          if(abort.signal.aborted||closed)return;
        }
        if(transcript!==null&&(decision.intent&&decision.intent!=='answer'||!decision.assessment))throw new Error('Answer was not assessed');
        if(transcript!==null&&typeof model.recoverNext==='function') {
          // Commit the authoritative grade first. A disconnect during recovery
          // resumes from this row, never from another assessment request.
          await store.saveAssessment(session.id,token,turn.sequence,transcript,decision.assessment);
          session=await store.get(user,session.id);
          let next=decision.next;
          if(decision.next_error){
            log('next_proposal_rejected',{reason:decision.next_error});
            next=await generate('next_question',()=>model.recoverNext(session,abort.signal,{followUp:decision.recovery_type==='follow_up'}));
          }
          if(abort.signal.aborted||closed)return;
          await store.commit(session.id,token,turn.sequence,null,{assessment:null,next,transition:decision.transition});
          decision.next=next;
        } else await store.commit(session.id,token,turn?.sequence||0,transcript,decision);
        session=await store.get(user,session.id);
        if(!decision.next||session.status!=='active'){await finish();return;}
        await speakQuestion();
      } finally {busy=false;}
    }
    async function resumeProgression() {
      if(busy||closed||abort.signal.aborted)return;
      busy=true;stopAudio();state('thinking');
      try {
        const current=session.turns.at(-1);
        log('next_recovery_resume',{sequence:current.sequence});
        const next=typeof model.recoverNext==='function'?await generate('resume_question',()=>model.recoverNext(session,abort.signal)):null;
        if(abort.signal.aborted||closed)return;
        await store.commit(session.id,token,current.sequence,null,{assessment:null,next,transition:null});
        session=await store.get(user,session.id);
        if(!next||session.status!=='active'){await finish();return;}
        await speakQuestion('question','',true);
      }finally{busy=false;}
    }
    ws.on('pong',()=>{lastPong=Date.now();});
    ws.on('message',(raw,binary)=>{
      (async()=>{
        if(closingWork){if(!binary){try{if(JSON.parse(raw).type==='played')closingPlayed?.();}catch{/* Ignore non-closing traffic. */}}return;}
        if(closed||abort.signal.aborted)return;
        if(Date.now()-windowStart>=1000){bytes=0;windowStart=Date.now();}
        bytes+=raw.length;
        if(bytes>100000){log('audio_rate_exceeded');ws.close(4508,'Audio rate exceeded');return;}
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
          if(previous){log('connection_replacement');previous.dispose();previous.ws.close(4001,'Connection resumed');}
          connections.set(sessionId,{ws,token,dispose});
          log(previous?'reconnect':'claim');
          // Read again only after fencing. A completed old turn could otherwise
          // be missed between the first read and the atomic ownership change.
          session=await store.get(user,sessionId);
          if(closed)return;
          clearTimeout(helloTimer);
          const remaining=Math.max(0,new Date(session.expires_at)-new Date(session.server_now));
          expiry=setTimeout(()=>{finish('time_limit').catch(err=>closeFailure('finalization',err,'Exam ended'));},remaining);
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
            }catch(err){closeFailure('heartbeat',err,'Connection unavailable');}finally{renewing=false;}
          },5000);
          send({type:'welcome',session:store.publicView(session),connectionId:connection});
          log('welcome',{auth_remaining_seconds:Number.isFinite(identity.expires)?Math.floor((identity.expires-Date.now())/1000):undefined});
          if(session.turns.length)log('session_resume');
          if(!session.turns.length&&remaining<=60000)await finish('insufficient_time');
          else if(!session.turns.length)await advance(null);
          else if(session.turns.at(-1).transcript&&!session.turns.at(-1).assessment)await advance(session.turns.at(-1).transcript);
          else if(session.turns.at(-1).assessment)await resumeProgression();
          else await speakQuestion('question','',true);
        }else if(msg.type==='played'&&phase==='speaking'&&msg.sequence===session.turns.at(-1)?.sequence){clearTimeout(playbackTimer);await listen();}
        else if(msg.type==='playback_failed'&&phase==='speaking'&&msg.sequence===session.turns.at(-1)?.sequence)await textFallback('playback_unavailable');
        else if(msg.type==='end'&&user&&session)await finish('student_ended');
        else if(msg.type==='hello')ws.close(4400,'Repeated handshake');
      })().catch(err=>{
        console.error('Oral exam connection failed:',examiner.diagnostic('connection',err,0));
        log(err.statusCode===409?'ownership_conflict':'connection_failure',{stage:phase,...details(err)});
        if(!user||!token){
          send({type:'error',message:err.statusCode===409?'This exam is connected elsewhere. Retrying shortly; the timer continues.':'Unable to connect to this exam. Sign in and retry.'});
          ws.close(err.statusCode===409?4429:4403,'Session unavailable');
        }
        else if(!abort.signal.aborted)error('The exam could not generate the next question. Your saved progress and timer are preserved.',err.retryAfterMs,err,'question');
      });
    });
    ws.on('error',err=>log('server_error',{error_class:err.name}));
    function dispose(){
      if(closed)return;
      closed=true;closingPlayed?.();abort.abort();stopAudio();clearTimeout(helloTimer);clearTimeout(expiry);clearTimeout(authExpiry);clearInterval(heartbeat);
      if(token&&session){
        if(connections.get(session.id)?.token===token)connections.delete(session.id);
        store.release(session.id,token).then(()=>log('release')).catch(err=>log('release_failure',{error_class:err.name}));
      }
    }
    ws.on('close',(code)=>{
      // Peer close reasons are arbitrary input; log the code and known server
      // meaning rather than possibly recording student content or a secret.
      const reasons={1000:'normal',1006:'transport_lost',4001:'resumed',4401:'authentication_expired',4403:'connection_rejected',4409:'ownership_conflict',4429:'lease_busy',4500:'connection_unavailable',4508:'audio_rate_exceeded'};
      log('disconnect',{code,reason:reasons[code]||'closed',elapsed_ms:Date.now()-connectedAt});
      if(session&&token&&!closingWork&&[1006,4500,4508].includes(code))store.interruption(session.id,token,reasons[code]).catch(()=>{});
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
      const pending=await store.pendingEvaluations();
      for(const row of pending)await model.evaluate(row.id_student==null?{id:row.user_id}:{id_student:row.id_student},row.id);
    }catch(err){console.error('Oral exam finalization failed:',err.code||err.name);}finally{sweeping=false;}
  },5000);
  sweep.unref();
  return {close(){clearInterval(sweep);for(const client of wss.clients)client.terminate();wss.close();},wss};
}
module.exports={attachRealtime,authenticate};
