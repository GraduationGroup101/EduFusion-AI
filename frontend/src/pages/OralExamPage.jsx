import {useCallback,useEffect,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {Mic,MicOff,Clock,BookOpen,ArrowRight,RotateCcw,CheckCircle} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import {oralExamService as api} from '../services/oralExam';
import {useOralExamVoice} from '../hooks/useOralExamVoice';
import MaterialUpload from '../components/oralExam/MaterialUpload';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import ExamReport from '../components/oralExam/ExamReport';
import '../styles/oral-exam.css';

const message=e=>e.response?.data?.error||e.message||'Unable to load Oral Exam. Please try again.';
const terminal=s=>s&&!['ready','active'].includes(s.status);
const labels={closing:'Closing the exam',idle:'Ready when you are',connecting:'Connecting to your examiner',connecting_audio:'Preparing to listen',thinking:'Examiner is thinking',speaking:'Examiner is speaking',listening:'Your turn — speak naturally',reconnecting:'Reconnecting — timer continues',error:'Connection needs attention',ended:'Exam finished'};
const remarkLabels={closing:'Closing',transition:'Examiner',repeat:'Repeating the question',clarification:'Clarification',nudge:'A gentle prompt',retry:'Please say that again'};
const exchangeLabels={repeat:'Asked to repeat',clarification:'Asked for clarification',nudge:'Said they did not know',retry:'Answer was not clear'};
// Safe reason codes from the gateway, in student-facing words. None of these
// imply that answers were lost.
const feedbackErrors={
  model_unavailable:'The feedback model is busy or unavailable right now. Your answers are saved; try again in a moment.',
  model_auth:'The feedback service is not configured correctly. Your answers are saved; please tell your administrator.',
  invalid_model_output:'The feedback model returned an unusable report. Your answers are saved; try again.',
  timeout:'Generating feedback took too long. Your answers are saved; try again.',
  network:'The feedback service could not be reached. Your answers are saved; try again.',
};
const feedbackError=code=>feedbackErrors[code]||'Feedback could not be generated yet. Your answers are saved; you can retry.';

export default function OralExamPage(){
  const [params,setParams]=useSearchParams();
  const [deleting,setDeleting]=useState(null);
  const [enabled,setEnabled]=useState(null),[materials,setMaterials]=useState([]),[history,setHistory]=useState([]),[selected,setSelected]=useState(''),[text,setText]=useState(''),[title,setTitle]=useState('My study material'),[language,setLanguage]=useState('en'),[fromFile,setFromFile]=useState(false);
  const [session,setSession]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[remaining,setRemaining]=useState(600),[warning,setWarning]=useState('');
  // Feedback generation has its own explicit state so a retry is always visible:
  // idle → generating → (report appears | failed with a reason, retryable).
  const [feedback,setFeedback]=useState({state:'idle',error:''});
  // True from the moment the student ends the exam until the gateway confirms
  // it, so the live view is replaced immediately rather than after feedback.
  const [ending,setEnding]=useState(false);
  const requestKey=useRef(null),clock=useRef(null),alive=useRef(true),sessionState=useRef(null),evaluating=useRef(null);
  const update=useCallback(snapshot=>{
    if(!alive.current)return;
    const previous=sessionState.current;
    if(previous?.id===snapshot.id&&terminal(previous)&&!terminal(snapshot))return;
    if(snapshot.expires_at&&snapshot.server_now){
      const at=performance.now(),candidate=Math.max(0,(new Date(snapshot.expires_at)-new Date(snapshot.server_now))/1000);
      const before=clock.current;
      const seconds=before?.id===snapshot.id&&before.expiresAt===snapshot.expires_at?Math.max(0,Math.min(candidate,before.seconds-(at-before.at)/1000)):candidate;
      clock.current={id:snapshot.id,expiresAt:snapshot.expires_at,at,seconds};setRemaining(Math.ceil(seconds));
    }
    const next=previous?.id===snapshot.id?{...previous,...snapshot}:snapshot;
    sessionState.current=next;setSession(next);
  },[]);
  const voice=useOralExamVoice(update);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    let cancelled=false;
    api.status().then(async({data})=>{
      if(cancelled)return;setEnabled(data.enabled);
      if(!data.enabled)return;
      const results=await Promise.allSettled([api.materials(params.get('lecture')),api.sessions()]);
      if(cancelled)return;
      if(results[0].status==='fulfilled'){
        const sources=results[0].value.data.materials;setMaterials(sources);
        const preset=sources.find(m=>(m.kind==='lecture'&&m.id===params.get('lecture'))||(m.kind==='transcript'&&m.id===params.get('transcript')));
        if(preset)setSelected(`${preset.kind}:${preset.id}`);
        if(results[0].value.data.library_unavailable)setWarning('The lecture library is unavailable. You can still use a transcript or upload text.');
      }else setWarning('Saved materials could not load. You can still upload text.');
      if(results[1].status==='fulfilled')setHistory(results[1].value.data.sessions);
    }).catch(e=>{if(!cancelled)setError(message(e));});
    return()=>{cancelled=true;};
  },[]); // Initial selection only; the session query changes during the exam.
  const sessionId=params.get('session');
  useEffect(()=>{
    if(!sessionId)return;
    let cancelled=false;
    api.get(sessionId).then(({data})=>{if(!cancelled)update(data.session);}).catch(e=>{if(!cancelled)setError(message(e));});
    return()=>{cancelled=true;};
  },[sessionId,update]);
  useEffect(()=>{
    if(session?.status!=='active')return;
    const timer=setInterval(()=>{if(clock.current)setRemaining(Math.max(0,Math.ceil(clock.current.seconds-(performance.now()-clock.current.at)/1000)));},250);
    let cancelled=false,pollTimer,controller;
    const poll=async()=>{
      controller=new AbortController();
      try{const {data}=await api.get(session.id,{signal:controller.signal});if(!cancelled)update(data.session);}
      catch{/* Socket recovery and the local clock continue through HTTP outages. */}
      finally{if(!cancelled)pollTimer=setTimeout(poll,10000);}
    };
    pollTimer=setTimeout(poll,10000);
    return()=>{cancelled=true;controller?.abort();clearInterval(timer);clearTimeout(pollTimer);};
  },[session?.id,session?.status,update]);
  useEffect(()=>{if(terminal(session)&&voice.state!=='closing')voice.stop();},[session?.status,voice.state,voice.stop]);
  // One evaluation request at a time, whether it comes from the automatic
  // first attempt or from the Retry button. The outcome is always shown.
  const requestFeedback=useCallback(async id=>{
    if(evaluating.current===id)return;
    evaluating.current=id;setFeedback({state:'generating',error:''});
    try{
      const {data}=await api.evaluate(id);
      // A result for a session the student has since left is ignored.
      if(!alive.current||evaluating.current!==id)return;
      update(data.session);
      const outcome=data.evaluation?.status||(data.session.evaluation_status==='ready'?'ready':'failed');
      if(outcome==='failed')setFeedback({state:'failed',error:feedbackError(data.evaluation?.error||data.session.evaluation_error)});
      else setFeedback({state:outcome==='pending'?'generating':'idle',error:''});
    }catch(e){if(alive.current&&evaluating.current===id)setFeedback({state:'failed',error:message(e)});}
    finally{if(evaluating.current===id)evaluating.current=null;}
  },[update]);
  // Reset feedback state when the student opens another exam, before any
  // automatic request for the new one runs.
  useEffect(()=>{setFeedback({state:'idle',error:''});evaluating.current=null;},[session?.id]);
  useEffect(()=>{
    if(!terminal(session)||session.evaluation_status!=='pending')return;
    requestFeedback(session.id);
  },[session?.id,session?.status,session?.evaluation_status,requestFeedback]);
  useEffect(()=>{
    if(!terminal(session)||session.evaluation_status!=='pending')return;
    let cancelled=false;
    const timer=setInterval(()=>api.get(session.id).then(({data})=>{if(!cancelled){update(data.session);if(data.session.evaluation_status!=='pending')setFeedback({state:'idle',error:''});}}).catch(()=>{}),2000);
    return()=>{cancelled=true;clearInterval(timer);};
  },[session?.id,session?.status,session?.evaluation_status,update]);
  async function run(work){if(busy)return;setBusy(true);setError('');try{await work();}catch(e){if(alive.current)setError(message(e));}finally{if(alive.current)setBusy(false);}}
  async function deleteExam(){
    const id=deleting.id;
    await api.remove(id);
    setHistory(items=>items.filter(item=>item.id!==id));setDeleting(null);
    if(session?.id===id){voice.stop();evaluating.current=null;sessionState.current=null;setSession(null);setParams({});requestKey.current=null;}
  }
  async function prepare(){
    let source;
    if(selected){const material=materials.find(m=>`${m.kind}:${m.id}`===selected);source={kind:material.kind,id:material.id};}
    else source={kind:'text',title,text};
    const body={source,language},signature=JSON.stringify(body);
    if(requestKey.current?.signature!==signature)requestKey.current={signature,key:crypto.randomUUID()};
    const {data}=await api.create(body,requestKey.current.key);update(data.session);setParams({session:data.session.id});
  }
  async function start(){
    if(!await voice.checkMic())return;
    try{const {data}=await api.start(session.id);update(data.session);voice.connect(data.session);}catch(e){voice.stop();throw e;}
  }
  async function reconnect(){
    if(!await voice.checkMic())return;
    const {data}=await api.get(session.id);update(data.session);
    if(data.session.status==='active')voice.connect(data.session);else voice.stop();
  }
  async function end(){
    voice.stop();setEnding(true);setFeedback({state:'generating',error:''});
    try{
      const {data}=await api.end(session.id);update(data.session);
      if(data.evaluation?.status==='failed')setFeedback({state:'failed',error:feedbackError(data.evaluation.error)});
      else if(data.evaluation?.status==='ready'||data.session.evaluation_status==='ready')setFeedback({state:'idle',error:''});
    }catch(e){setFeedback({state:'idle',error:''});throw e;}
    finally{if(alive.current)setEnding(false);}
  }
  const report=session?.evaluation;
  const generating=feedback.state==='generating';

  // After an exam on a saved transcript, continue with that lecture's other tools.
  const transcriptId=session?.source?.kind==='transcript'?session.source.id:null;
  const lectureLink=tool=>`/dashboard/lecturescribe?job=${encodeURIComponent(transcriptId)}&tool=${tool}`;
  const direction=session?.language==='ar'?'rtl':'auto';
  return <div className="oral-exam-page">
    <PageHeader title="Oral Exam" description="Turn what you’ve learned into a conversation."><span className="oral-duration"><Clock size={16}/>10 minutes maximum</span></PageHeader>
    {(error||voice.error)&&<div className="oral-notice" role="alert">{error||voice.error}</div>}
    {enabled===null&&!error&&<p role="status">Loading your exam workspace…</p>}
    {enabled===false&&<section className="oral-panel"><h2>Oral Exam is being prepared</h2><p>Your other learning tools are available while voice examination is configured.</p><Link to="/dashboard/lecturescribe">Open LectureScribe</Link></section>}
    {enabled&&!session&&<>
      <section className="oral-panel oral-setup"><div><span className="oral-eyebrow">01 / YOUR MATERIAL</span><h2>What would you like to explore?</h2><p>Choose a completed lecture or bring your own notes. Questions will use only this material.</p>{warning&&<p role="status">{warning}</p>}
        <label>Saved lecture<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Use my own text</option>{materials.map(m=><option key={`${m.kind}:${m.id}`} value={`${m.kind}:${m.id}`}>{m.title}</option>)}</select></label>
        {!selected&&<><MaterialUpload disabled={busy} onExtracted={m=>{setText(m.text);setTitle(m.title);setFromFile(true);}} onCleared={()=>{setText('');setTitle('My study material');setFromFile(false);}}/><label>Material title<input value={title} maxLength={160} onChange={e=>setTitle(e.target.value)}/></label><label>{fromFile?'Extracted material — the exam uses exactly this text':'Or paste your study material'}<textarea rows={fromFile?12:7} value={text} maxLength={90000} onChange={e=>setText(e.target.value)} placeholder="Paste at least 100 characters of lecture notes or a transcript…"/></label><p className="oral-hint oral-count">{text.trim().length.toLocaleString('en-US')} / 90,000 characters{text.trim().length<100?' · at least 100 needed':''}</p></>}
        <label>Exam language<select value={language} onChange={e=>setLanguage(e.target.value)}><option value="en">English</option><option value="ar">العربية</option></select></label>
        <button className="button-primary" disabled={busy||(!selected&&text.trim().length<100)} onClick={()=>run(prepare)}>Prepare exam <ArrowRight size={17}/></button>
      </div><aside className="oral-guide"><BookOpen size={32}/><h3>A conversation about understanding</h3><p>One question at a time. Follow-up questions adapt to what you say. You can ask the examiner to repeat or clarify a question.</p><ol><li>Choose material you’ve studied.</li><li>Check your microphone.</li><li>Speak naturally and review your feedback.</li></ol><p className="oral-hint">Your voice is sent to a speech provider during the exam. EduFusion saves final transcripts and feedback, not audio recordings. This practice score is separate from your course grades.</p></aside></section>
      {history.length>0&&<section className="oral-panel"><h2>Your recent exams</h2><div className="oral-history">{history.map(s=><div className="oral-history-row" key={s.id}><button onClick={()=>setParams({session:s.id})}><span>{s.material_title}</span><span>{s.status.replace('_',' ')} <ArrowRight size={16}/></span></button>{s.status!=='active'&&<button className="oral-delete" aria-label={`Delete ${s.material_title}`} disabled={busy} onClick={()=>setDeleting(s)}>Delete</button>}</div>)}</div></section>}
    </>}
    {session?.status==='ready'&&<section className="oral-panel oral-ready"><span className="oral-eyebrow">02 / BEFORE YOU BEGIN</span><h2>{session.material_title}</h2><p>Find a quiet spot. Your examiner will ask short questions and adapt to your answers. If a question is unclear, just say so or ask for it again.</p><div className="oral-ready-facts"><span><Clock/>Up to 10 minutes</span><span>{voice.mic?<CheckCircle/>:<Mic/>}{voice.mic?'Microphone ready':'Microphone not checked'}</span></div><p>The timer starts when you start the exam and continues if you disconnect.</p><div className="oral-actions"><button className="btn-secondary" onClick={()=>run(voice.checkMic)} disabled={busy}>Check microphone</button><button className="button-primary" onClick={()=>run(start)} disabled={busy}>Start oral exam <ArrowRight size={17}/></button></div></section>}
    {voice.state==='closing'&&<section className="oral-panel" role="status" dir={direction}><h2>Closing the exam</h2><p>{voice.remark?.text}</p></section>}
    {session?.status==='active'&&!ending&&voice.state!=='closing'&&<section className="oral-panel oral-live"><div className="oral-live-top"><span>{session.material_title}</span><span className={`oral-timer ${remaining<=60?'is-ending':''}`} aria-label="Time remaining"><Clock size={17}/>{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</span></div><div className={`oral-orb ${voice.state==='speaking'||voice.state==='listening'?'is-active':''}`}><Mic size={38}/></div><p className="oral-eyebrow" role="status">{labels[voice.state]||voice.state}</p>{voice.remark&&<p className="oral-remark" dir={direction} role="status" aria-label={remarkLabels[voice.remark.kind]||'Examiner'}><span className="oral-remark-kind">{remarkLabels[voice.remark.kind]||'Examiner'}</span>{voice.remark.text}</p>}<h2 dir={direction}>{voice.question||session.turns?.at(-1)?.question||'Your examiner is getting ready.'}</h2><>{voice.audioUnavailable&&<p className="oral-hint" role="status" dir={direction}>{session.language==='ar'?'الصوت غير متاح مؤقتًا. يمكنك متابعة الإجابة باستخدام الميكروفون والسؤال الظاهر على الشاشة.':'Audio is temporarily unavailable. You can continue with the question shown on screen.'}</p>}</><p className="oral-hint">{voice.muted?'Microphone muted':voice.state==='listening'?'Pause briefly when you finish your answer. You can also ask to repeat or clarify the question.':'Listen to the question before answering.'}</p><div className="oral-actions"><button className="btn-secondary" onClick={voice.toggleMute} disabled={!voice.mic}>{voice.muted?<MicOff size={18}/>:<Mic size={18}/>} {voice.muted?'Unmute':'Mute'}</button>{['idle','error'].includes(voice.state)&&<button className="button-primary" onClick={()=>run(reconnect)} disabled={busy}><RotateCcw size={17}/>Reconnect</button>}<button className="btn-secondary" onClick={()=>run(end)} disabled={busy}>End exam</button></div></section>}
    {(terminal(session)||ending)&&<section className="oral-panel oral-results"><span className="oral-eyebrow">YOUR EXAM REVIEW</span><h2>{session.material_title}</h2><p>{session.status==='timed_out'?'Your ten-minute exam has ended.':'Your exam has ended.'}</p><p dir={direction}>{session.closing_message}</p><ExamReport report={report} status={session.evaluation_status} generating={generating} error={feedback.state==='failed'?feedback.error:session.evaluation_status==='failed'?feedbackError(session.evaluation_error):''} onRetry={()=>requestFeedback(session.id)}/>{transcriptId&&<nav className="oral-actions" aria-label="Continue with this lecture"><Link className="btn-secondary" to={lectureLink('chat')}>Ask this lecture about weak topics</Link><Link className="btn-secondary" to={lectureLink('quiz')}>Practice questions on this lecture</Link></nav>}
      <details><summary>Review questions and answers</summary>{session.turns?.map(t=><article key={t.id}><h3 dir={direction}>{t.sequence}. {t.question}</h3>{t.exchanges?.map((e,i)=><p key={i} className="oral-exchange" dir={direction}><span className="oral-remark-kind">{exchangeLabels[e.kind]||e.kind}</span>{e.transcript?<q>{e.transcript}</q>:null} <span className="oral-hint">Examiner: {e.reply}</span></p>)}<p dir={direction}>{t.transcript||'No completed answer recorded.'}</p>{t.feedback&&<p className="oral-hint">{t.feedback}</p>}</article>)}</details></section>}
    <ConfirmDialog open={Boolean(deleting)} title="Delete this exam?" description="This permanently deletes the exam, its answers and its report. Your source material is kept." confirmLabel="Delete exam" busy={busy} onCancel={()=>{if(!busy)setDeleting(null);}} onConfirm={()=>run(deleteExam)}/>
    {session&&session.status!=='active'&&<button className="oral-back" disabled={busy} onClick={()=>setDeleting(session)}>Delete exam</button>}
    {session&&session.status!=='active'&&<button className="oral-back" onClick={()=>{voice.stop();sessionState.current=null;setSession(null);setParams({});requestKey.current=null;setError('');api.sessions().then(({data})=>setHistory(data.sessions)).catch(e=>setError(message(e)));}}>Choose material for another exam</button>}
  </div>;
}
