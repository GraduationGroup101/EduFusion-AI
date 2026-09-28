import {useCallback,useEffect,useRef,useState} from 'react';
import {Link,useSearchParams} from 'react-router-dom';
import {Mic,MicOff,Clock,BookOpen,ArrowRight,RotateCcw,CheckCircle} from 'lucide-react';
import PageHeader from '../components/ui/PageHeader';
import {oralExamService as api} from '../services/oralExam';
import {useOralExamVoice} from '../hooks/useOralExamVoice';
import '../styles/oral-exam.css';

const message=e=>e.response?.data?.error||e.message||'Unable to load Oral Exam. Please try again.';
const terminal=s=>s&&!['ready','active'].includes(s.status);
const labels={idle:'Ready when you are',connecting:'Connecting to your examiner',connecting_audio:'Preparing to listen',thinking:'Examiner is thinking',speaking:'Examiner is speaking',listening:'Your turn — speak naturally',reconnecting:'Reconnecting — timer continues',error:'Connection needs attention',ended:'Exam finished'};

export default function OralExamPage(){
  const [params,setParams]=useSearchParams();
  const [enabled,setEnabled]=useState(null),[materials,setMaterials]=useState([]),[history,setHistory]=useState([]),[selected,setSelected]=useState(''),[text,setText]=useState(''),[title,setTitle]=useState('My study material'),[language,setLanguage]=useState('en');
  const [session,setSession]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[remaining,setRemaining]=useState(600),[warning,setWarning]=useState('');
  const requestKey=useRef(null),clock=useRef(null),alive=useRef(true);
  const update=useCallback(snapshot=>{
    if(!alive.current)return;
    if(snapshot.expires_at&&snapshot.server_now)clock.current={at:performance.now(),seconds:Math.max(0,(new Date(snapshot.expires_at)-new Date(snapshot.server_now))/1000)};
    setSession(previous=>previous?.id===snapshot.id?{...previous,...snapshot}:snapshot);
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
        const preset=sources.find(m=>m.kind==='lecture'&&m.id===params.get('lecture'));
        if(preset)setSelected(`lecture:${preset.id}`);
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
    const poll=setInterval(()=>api.get(session.id).then(({data})=>update(data.session)).catch(()=>{}),10000);
    return()=>{clearInterval(timer);clearInterval(poll);};
  },[session?.id,session?.status,update]);
  useEffect(()=>{if(terminal(session))voice.stop();},[session?.status,voice.stop]);
  useEffect(()=>{
    if(!terminal(session)||session.evaluation_status!=='pending')return;
    let cancelled=false;
    api.evaluate(session.id).then(({data})=>{if(!cancelled)update(data.session);}).catch(e=>{if(!cancelled)setError(message(e));});
    return()=>{cancelled=true;};
  },[session?.id,session?.status,session?.evaluation_status,update]);
  async function run(work){if(busy)return;setBusy(true);setError('');try{await work();}catch(e){if(alive.current)setError(message(e));}finally{if(alive.current)setBusy(false);}}
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
  async function end(){voice.stop();const {data}=await api.end(session.id);update(data.session);}
  async function upload(file){
    if(!file)return;
    if(!/\.txt$/i.test(file.name)||file.size>90000)throw new Error('Choose a UTF-8 .txt file up to 90 KB. Export PDF, Word or PowerPoint content as text first.');
    setText(await file.text());setTitle(file.name.replace(/\.txt$/i,''));setSelected('');
  }
  const report=session?.evaluation;
  return <div className="oral-exam-page">
    <PageHeader title="Oral Exam" description="Turn what you’ve learned into a conversation."><span className="oral-duration"><Clock size={16}/>10 minutes maximum</span></PageHeader>
    {(error||voice.error)&&<div className="oral-notice" role="alert">{error||voice.error}</div>}
    {enabled===null&&!error&&<p role="status">Loading your exam workspace…</p>}
    {enabled===false&&<section className="oral-panel"><h2>Oral Exam is being prepared</h2><p>Your other learning tools are available while voice examination is configured.</p><Link to="/dashboard/youtube">Open LectureScribe</Link></section>}
    {enabled&&!session&&<>
      <section className="oral-panel oral-setup"><div><span className="oral-eyebrow">01 / YOUR MATERIAL</span><h2>What would you like to explore?</h2><p>Choose a completed lecture or bring your own notes. Questions will use only this material.</p>{warning&&<p role="status">{warning}</p>}
        <label>Saved lecture<select value={selected} onChange={e=>setSelected(e.target.value)}><option value="">Use my own text</option>{materials.map(m=><option key={`${m.kind}:${m.id}`} value={`${m.kind}:${m.id}`}>{m.title}</option>)}</select></label>
        {!selected&&<><label>Upload notes <span className="oral-hint">UTF-8 .txt · up to 90 KB</span><input type="file" accept=".txt,text/plain" onChange={e=>run(()=>upload(e.target.files?.[0]))}/></label><label>Material title<input value={title} maxLength={160} onChange={e=>setTitle(e.target.value)}/></label><label>Or paste your study material<textarea rows={7} value={text} maxLength={90000} onChange={e=>setText(e.target.value)} placeholder="Paste at least 100 characters of lecture notes or a transcript…"/></label></>}
        <label>Exam language<select value={language} onChange={e=>setLanguage(e.target.value)}><option value="en">English</option><option value="ar">العربية</option></select></label>
        <button className="button-primary" disabled={busy||(!selected&&text.trim().length<100)} onClick={()=>run(prepare)}>Prepare exam <ArrowRight size={17}/></button>
      </div><aside className="oral-guide"><BookOpen size={32}/><h3>A conversation about understanding</h3><p>One question at a time. Follow-up questions adapt to what you say.</p><ol><li>Choose material you’ve studied.</li><li>Check your microphone.</li><li>Speak naturally and review your feedback.</li></ol><p className="oral-hint">Your voice is sent to a speech provider during the exam. EduFusion saves final transcripts and feedback, not audio recordings. This practice score is separate from your course grades.</p></aside></section>
      {history.length>0&&<section className="oral-panel"><h2>Your recent exams</h2><div className="oral-history">{history.map(s=><button key={s.id} onClick={()=>setParams({session:s.id})}><span>{s.material_title}</span><span>{s.status.replace('_',' ')} <ArrowRight size={16}/></span></button>)}</div></section>}
    </>}
    {session?.status==='ready'&&<section className="oral-panel oral-ready"><span className="oral-eyebrow">02 / BEFORE YOU BEGIN</span><h2>{session.material_title}</h2><p>Find a quiet spot. Your examiner will ask short questions and adapt to your answers.</p><div className="oral-ready-facts"><span><Clock/>Up to 10 minutes</span><span>{voice.mic?<CheckCircle/>:<Mic/>}{voice.mic?'Microphone ready':'Microphone not checked'}</span></div><p>The timer starts when you start the exam and continues if you disconnect.</p><div className="oral-actions"><button className="btn-secondary" onClick={()=>run(voice.checkMic)} disabled={busy}>Check microphone</button><button className="button-primary" onClick={()=>run(start)} disabled={busy}>Start oral exam <ArrowRight size={17}/></button></div></section>}
    {session?.status==='active'&&<section className="oral-panel oral-live"><div className="oral-live-top"><span>{session.material_title}</span><span className={`oral-timer ${remaining<=60?'is-ending':''}`} aria-label="Time remaining"><Clock size={17}/>{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</span></div><div className={`oral-orb ${voice.state==='speaking'||voice.state==='listening'?'is-active':''}`}><Mic size={38}/></div><p className="oral-eyebrow" role="status">{labels[voice.state]||voice.state}</p><h2 dir={session.language==='ar'?'rtl':'auto'}>{voice.question||session.turns?.at(-1)?.question||'Your examiner is getting ready.'}</h2><p className="oral-hint">{voice.muted?'Microphone muted':voice.state==='listening'?'Pause briefly when you finish your answer.':'Listen to the question before answering.'}</p><div className="oral-actions"><button className="btn-secondary" onClick={voice.toggleMute} disabled={!voice.mic}>{voice.muted?<MicOff size={18}/>:<Mic size={18}/>} {voice.muted?'Unmute':'Mute'}</button>{['idle','error'].includes(voice.state)&&<button className="button-primary" onClick={()=>run(reconnect)} disabled={busy}><RotateCcw size={17}/>Reconnect</button>}<button className="btn-secondary" onClick={()=>run(end)} disabled={busy}>End exam</button></div></section>}
    {terminal(session)&&<section className="oral-panel oral-results"><span className="oral-eyebrow">YOUR EXAM REVIEW</span><h2>{session.material_title}</h2><p>{session.status==='timed_out'?'Your ten-minute exam has ended.':'Your exam has ended.'}</p>{report?<><div className="oral-score"><strong>{report.score??'—'}</strong><span>{report.score==null?'Not scored':'out of 100'}</span></div><p>{report.summary}</p><div className="oral-breakdown">{[['understanding','Understanding','40%'],['accuracy','Accuracy','30%'],['completeness','Completeness','20%'],['communication','Communication','10%']].map(([key,label,weight])=><div key={key}><span>{label} <small>{weight}</small></span><strong>{report[key]??'—'}</strong><progress value={report[key]||0} max="100" aria-label={label}/></div>)}</div><div className="oral-feedback">{[['strengths','What went well'],['areasForImprovement','What to work on'],['topicsCovered','Topics explored']].map(([key,label])=><div key={key}><h3>{label}</h3><ul>{report[key]?.map((item,i)=><li key={i}>{item}</li>)}</ul></div>)}</div><details><summary>Review questions and answers</summary>{session.turns?.map(t=><article key={t.id}><h3>{t.sequence}. {t.question}</h3><p>{t.transcript||'No completed answer recorded.'}</p>{t.feedback&&<p className="oral-hint">{t.feedback}</p>}</article>)}</details></>:<div role="status"><p>{session.evaluation_status==='failed'?'Your answers are saved. Feedback could not be generated yet.':'Preparing your feedback…'}</p><button className="btn-secondary" disabled={busy} onClick={()=>run(async()=>update((await api.evaluate(session.id)).data.session))}>Retry feedback</button></div>}</section>}
    {session&&session.status!=='active'&&<button className="oral-back" onClick={()=>{voice.stop();setSession(null);setParams({});requestKey.current=null;setError('');}}>Choose material for another exam</button>}
  </div>;
}
