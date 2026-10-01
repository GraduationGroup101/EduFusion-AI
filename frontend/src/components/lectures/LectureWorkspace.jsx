import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, FileText, MessageSquare, ListChecks, Send, TextQuote, X, Loader2, RotateCcw } from 'lucide-react';
import TranscriptView, { arabicRatio } from './TranscriptView';
import { lectureStudyService as service } from '../../services/lectureStudy';
const message = (error) => error.response?.data?.error || 'Unable to load this lecture. Please try again.';

// Each block takes the direction of its main script: "dir=auto" alone follows the
// first letter, which turns an Arabic paragraph that opens with "TCP" left-to-right.
export const textDirection = (text) => arabicRatio(text) >= 0.3 ? 'rtl' : /[A-Za-z]/.test(String(text || '')) ? 'ltr' : 'auto';
export function Paragraphs({ text, className = '' }) {
  return <div className={'space-y-3 leading-7 break-words ' + className}>
    {String(text || '').split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean).map((part, index) =>
      <p key={index} dir={textDirection(part)} className="whitespace-pre-wrap" style={{ textAlign: 'start' }}>{part}</p>)}
  </div>;
}
// Headings, list items or bold text: spoken words never contain these markers.
const MARKDOWN_STRUCTURE = /^(?:#{1,3} |- |\d+\. )/m;
const MARKDOWN_BOLD = /\*\*[^*\n]+\*\*/;
// A transcript stored without a separate formatted copy is shown once, as the original.
// Older imports stored the formatted Markdown in both fields: that copy is shown as
// formatted, never as the words "exactly as spoken" with literal Markdown markers.
export const transcriptVersions = (lecture) => {
  const raw = lecture?.raw_transcript || null, transcript = lecture?.transcript || null;
  if (transcript && transcript === raw) {
    return MARKDOWN_STRUCTURE.test(transcript) || MARKDOWN_BOLD.test(transcript) ? { cleaned: transcript, raw: null } : { cleaned: null, raw };
  }
  return { cleaned: transcript, raw };
};
const button = 'inline-flex items-center gap-2 border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-40';
const input = 'w-full border border-border bg-white p-3 text-sm outline-none focus:border-secondary';

export default function LectureWorkspace({ lectureId, initialTab='summary', onClose }) {
  const [lecture,setLecture] = useState(null);
  const [tab,setTab] = useState(initialTab);
  const [error,setError] = useState('');
  const [messages,setMessages] = useState([]);
  const [question,setQuestion] = useState('');
  const [pending,setPending] = useState(null);
  const [quiz,setQuiz] = useState(null);
  const [quizzes,setQuizzes] = useState([]);
  const [answers,setAnswers] = useState({});
  const [attempt,setAttempt] = useState(null);
  const [attempts,setAttempts] = useState([]);
  const [recommendations,setRecommendations] = useState(null);
  const [counts,setCounts] = useState({mcq:6,tf:3,essay:1,section:null});
  const [busy,setBusy] = useState(false);
  const [sourceId,setSourceId] = useState(null);
  const [transcript,setTranscript] = useState({state:'idle'});
  const transcriptRequest = useRef(null);
  const request = useRef(null);
  const alive = useRef(true);
  const panel = useRef(null);
  const generation = useRef(0);
  // The latest close handler, so a parent re-render never re-runs the focus trap.
  const close = useRef(onClose);
  close.current = onClose;
  const ready = lecture?.status === 'ready';
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const keydown = (event) => {
      if (event.key === 'Escape') close.current();
      if (event.key !== 'Tab') return;
      const elements = [...panel.current.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]')];
      const first=elements[0],last=elements.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault();last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault();first?.focus(); }
    };
    document.addEventListener('keydown',keydown);
    return () => { document.body.style.overflow=overflow;document.removeEventListener('keydown',keydown);previous?.focus(); };
  },[]);
  const refresh = useCallback(async (signal) => {
    const current = generation.current;
    const {data} = await service.lecture(lectureId,signal);
    if (!alive.current || generation.current !== current || signal?.aborted) return;
    setLecture(data.lecture);
    if (data.lecture.status !== 'ready') return;
    const values = await Promise.allSettled([
      service.messages(lectureId,signal),service.quizzes(lectureId,signal),
      service.attempts(lectureId,signal),service.recommendations(lectureId,signal),
    ]);
    if (!alive.current || generation.current !== current || signal?.aborted) return;
    if(values[0].status==='fulfilled')setMessages(values[0].value.data.messages);
    if(values[1].status==='fulfilled')setQuizzes(values[1].value.data.quizzes);
    if(values[2].status==='fulfilled')setAttempts(values[2].value.data.attempts);
    if(values[3].status==='fulfilled')setRecommendations(values[3].value.data);
    const waiting = data.lecture.jobs?.find((item) => ['queued','running'].includes(item.status)&&item.kind!=='prepare');
    if (waiting) setPending((previous) => previous || waiting);
    const failed=data.lecture.jobs?.find((item) => item.status==='failed');
    if(failed)setPending((previous) => previous || failed);
  },[lectureId]);
  useEffect(() => {
    alive.current=true;generation.current++;
    setLecture(null);setMessages([]);setQuestion('');setPending(null);setQuiz(null);setQuizzes([]);
    setAnswers({});setAttempt(null);setAttempts([]);setError('');setTab(initialTab);request.current=null;
    setBusy(false);setSourceId(null);setRecommendations(null);setTranscript({state:'idle'});
    const controller = new AbortController();
    refresh(controller.signal).catch((error) => { if (!controller.signal.aborted) setError(message(error)); });
    return () => {alive.current=false;generation.current++;controller.abort();transcriptRequest.current?.abort();};
  },[lectureId,initialTab,refresh]);
  useEffect(() => {
    if ((!lecture || ready || lecture.status === 'failed') && (!pending || ['completed','failed','cancelled'].includes(pending.status))) return undefined;
    let stopped=false,timer;
    const controller=new AbortController();
    const poll = async () => {
      if (document.hidden) { timer=setTimeout(poll,10000);return; }
      try {
        if (pending?.id) {
          const {data} = await service.job(pending.id,controller.signal);
          if (stopped) return;
          if (data.job.status === 'completed') {
            if (data.job.kind === 'quiz') {
              const loaded = await service.quiz(data.job.result.quiz_id,controller.signal);
              if (stopped) return;
              setQuiz(loaded.data.quiz);setAnswers({});setAttempt(null);setTab('quiz');
            }
            await refresh(controller.signal);
            if (!stopped) setPending(null);
          } else setPending(data.job);
        } else await refresh(controller.signal);
      } catch (error) { if (!stopped && !controller.signal.aborted) setError(message(error)); }
      if (!stopped) timer=setTimeout(poll,5000);
    };
    timer=setTimeout(poll,3000);
    return () => {stopped=true;clearTimeout(timer);controller.abort();};
  },[lecture?.status,ready,pending?.id,pending?.status,refresh]);
  const mutation = async (kind,payload,action) => {
    if (busy) return;
    setBusy(true);setError('');
    const signature=JSON.stringify({lectureId,kind,payload});
    if (!request.current || request.current.signature !== signature) request.current={signature,key:crypto.randomUUID()};
    const current=generation.current;
    try {
      const result=await action(request.current.key);
      if (!alive.current || generation.current !== current) return;
      request.current=null;
      return result.data;
    } catch (error) {
      if (alive.current && generation.current === current) {
        setError(message(error));
        if (error.response?.status >=400 && error.response?.status<500) request.current=null;
      }
    } finally { if (alive.current && generation.current === current) setBusy(false); }
  };
  const ask = async (event) => {
    event.preventDefault();
    if (!question.trim() || pending || !ready) return;
    const result=await mutation('chat',{question:question.trim()},(key) => service.ask(lectureId,question.trim(),key));
    if (result) { setPending(result.job);setQuestion('');await refresh().catch((error) => setError(message(error))); }
  };
  const generate = async () => {
    const result=await mutation('quiz',counts,(key) => service.generate(lectureId,counts,key));
    if (result) {
      setPending(result.job);
      if (result.job.status === 'completed' && result.job.result?.quiz_id) {
        const {data}=await service.quiz(result.job.result.quiz_id);setQuiz(data.quiz);setAnswers({});setAttempt(null);setPending(null);
      }
    }
  };
  const submit = async (event) => {
    event.preventDefault();
    const result=await mutation('attempt',answers,(key) => service.submit(quiz.id,answers,key));
    if (result) {setAttempt(result.attempt);await refresh().catch((error) => setError(message(error)));}
  };
  const openQuiz = async (id) => {
    try { const {data}=await service.quiz(id);if (!alive.current) return;setQuiz(data.quiz);setAnswers({});setAttempt(null);setError(''); }
    catch (error) {if (alive.current) setError(message(error));}
  };
  // The full transcript is large, so it is loaded once, when its tab is first opened.
  const hasTranscript = Boolean(lecture?.has_transcript);
  // Switching lectures aborts it (above); a late answer for another lecture is ignored.
  useEffect(() => {
    if (tab !== 'transcript' || !hasTranscript || transcript.state !== 'idle') return;
    const controller = new AbortController(), current = generation.current;
    transcriptRequest.current = controller;
    setTranscript({state:'loading'});
    service.transcript(lectureId,controller.signal).then(({data}) => {
      if (alive.current && generation.current === current) setTranscript({state:'ready',...transcriptVersions(data.transcript)});
    }).catch((error) => {
      if (!controller.signal.aborted && alive.current && generation.current === current) setTranscript({state:'error',error:message(error)});
    });
  },[tab,hasTranscript,transcript.state,lectureId]);
  const cite = (id) => {setSourceId(id);setTab('sources');};
  useEffect(() => {
    if(tab==='sources'&&sourceId)document.getElementById('source-'+sourceId)?.scrollIntoView?.({block:'center',behavior:'smooth'});
  },[tab,sourceId]);
  const references = (citations=[]) => <div className="flex flex-wrap gap-2 mt-2">{citations.map((id) =>
    <button type="button" className="text-xs text-accent underline" key={id} onClick={() => cite(id)}>Source {id}</button>)}</div>;
  return <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={lecture?.title || 'Lecture workspace'}
      onClick={(event) => event.stopPropagation()} className="bg-white w-full min-w-0 md:max-w-4xl h-full flex flex-col shadow-xl outline-none">
      <header className="p-4 border-b border-border flex shrink-0 items-center justify-between gap-3">
        <div><h2 className="font-display text-lg font-bold">{lecture?.title || 'Loading lecture'}</h2>
          <p className="text-xs text-light-accent/60">This chat and practice use this lecture only.</p></div>
        <button className={button} onClick={onClose} aria-label="Close lecture workspace"><X size={18}/></button>
      </header>
      <nav className="p-3 flex shrink-0 flex-wrap gap-2 border-b border-border" aria-label="Lecture tools">
        {ready && <Link className={button} to={`/dashboard/oral-exam?lecture=${lectureId}`} onClick={onClose}>Start Oral Exam</Link>}
        {[['summary','Summary',BookOpen],['chat','Lecture chat',MessageSquare],['quiz','Practice questions',ListChecks],['transcript','Transcript',FileText],['sources','Sources',TextQuote]].map(([key,label,Icon]) =>
          <button key={key} className={button+(tab===key?' bg-secondary text-white':'')} aria-pressed={tab===key} onClick={() => setTab(key)}><Icon size={16}/>{label}</button>)}
      </nav>
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6 space-y-5 break-words">
        {error && <p role="alert" className="p-3 bg-red-50 text-red-700">{error}</p>}
        {!lecture && !error && <p><Loader2 className="inline animate-spin" size={16}/> Loading saved lecture...</p>}
        {lecture && !ready && <div className="bg-amber-50 p-4" role="status">
          <p>{lecture.status === 'failed' ? 'Preparation needs another attempt.' : 'Preparing this lecture: '+lecture.stage}</p>
          <p className="text-sm mt-2">Your request is saved. Processing resumes when the local worker is available.</p>
          {lecture.error && <p className="text-sm mt-2">{lecture.error}</p>}
          {lecture.status==='failed'&&!lecture.jobs?.some(job=>job.kind==='prepare'&&job.status==='failed')&&<button className={button+' mt-3'} disabled={busy} onClick={async()=>{
            const result=await mutation('prepare',{lectureId},key=>service.create({youtube_url:lecture.youtube_url,language:lecture.language,title:lecture.title,enrollment_id:lecture.enrollment_id},key));
            if(result){setPending(result.job);await refresh().catch(error=>setError(message(error)));}
          }}>Retry lecture preparation</button>}
        </div>}
        {pending && <div role="status" className="p-3 bg-secondary/10 text-sm">
          {pending.status === 'failed' ? 'This request could not finish.' : 'Your '+pending.kind+' request is saved: '+pending.status+'. You may close this window.'}
          {pending.status==='failed' && <button className={button+' ml-2'} onClick={async () => {
            try {const {data}=await service.retry(pending.id);setPending({...pending,...data.job});setError('');} catch(error){setError(message(error));}
          }}><RotateCcw size={14}/>Retry</button>}
          {['failed','cancelled'].includes(pending.status) && <button className={button+' ml-2'} onClick={() => setPending(null)}>Dismiss</button>}
        </div>}
        {tab==='summary' && ready && <>
          <Paragraphs text={lecture.summary}/>
          <div className="flex flex-wrap gap-2">{lecture.concepts.map((concept) => <button className={button} key={concept}
            onClick={() => {setQuestion('Explain this concept from the lecture: '+concept);setTab('chat');}}>{concept}</button>)}</div>
          {lecture.sections.map((section) => <article key={section.id} className="border border-border p-4" dir={textDirection(section.title+' '+section.summary)}>
            <h3 className="font-bold">{section.title}</h3><p className="whitespace-pre-wrap mt-2">{section.summary}</p>{references(section.citations)}
            <div className="flex flex-wrap gap-2 mt-3">
              <button className={button} onClick={() => {setQuestion('Explain this lecture section: '+section.title);setTab('chat');}}>Explain this section</button>
              <button className={button} onClick={() => {setCounts({...counts,section:section.id});setTab('quiz');}}>Practice this section</button>
            </div>
          </article>)}
          {recommendations && <aside className="border border-border p-4" aria-label="Study recommendations">
            <h3 className="font-bold">Your next study steps</h3>
            {recommendations.prediction && <p className="text-sm mt-2">EduPredict: {recommendations.prediction.risk_level} · {new Date(recommendations.prediction.created_at).toLocaleDateString()}</p>}
            {recommendations.prediction?.recommended_action&&<p className="text-sm mt-2" dir="auto">{recommendations.prediction.recommended_action}</p>}
            {recommendations.course && !recommendations.prediction && <p className="text-sm">No current prediction is available for this course.</p>}
            <ol className="list-decimal pl-5 mt-2">{recommendations.steps.map((step) => <li key={step}>{step}</li>)}</ol>
            {recommendations.weak_concepts.map((item) => <div key={item.concept} className="mt-3">
              <p>Review: {item.concept} ({item.correct}/{item.total})</p>{references(item.citations)}
              <button className={button} onClick={() => {setQuestion('Help me understand '+item.concept);setTab('chat');}}>Ask about this concept</button>
            </div>)}
            <p className="text-xs mt-3 text-light-accent/60">Practice results are separate from academic grades and prediction inputs.</p>
          </aside>}
        </>}
        {tab==='chat' && <>
          {messages.map((item) => <article key={item.id} className="space-y-3 border-b border-border pb-4">
            <p dir={textDirection(item.question)} className="bg-secondary/10 p-3 whitespace-pre-wrap">{item.question}</p>
            <div dir={textDirection(item.answer)} className="p-3 whitespace-pre-wrap">{item.answer || (item.status==='failed'?'Request failed. Retry from its saved status.':'Waiting for the lecture assistant...')}{references(item.citations)}</div>
          </article>)}
          {ready && !messages.length && <p className="text-sm text-light-accent/60">Ask a question about this lecture. Answers include references to its text.</p>}
          <form onSubmit={ask} className="flex flex-col sm:flex-row gap-2">
            <textarea aria-label="Question about this lecture" dir="auto" className={input} value={question} maxLength={2000} disabled={!ready}
              onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about this lecture"/>
            <button className={button} disabled={!ready||busy||Boolean(pending)||!question.trim()}><Send size={16}/>Send</button>
          </form>
          {messages.length>0 && <button className={button} disabled={busy} onClick={async () => {
            try {await service.clearMessages(lectureId);setMessages([]);setPending(null);} catch(error){setError(message(error));}
          }}>Clear this lecture conversation</button>}
        </>}
        {tab==='quiz' && <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[['mcq','Multiple choice'],['tf','True / false'],['essay','Essay']].map(([key,label]) =>
              <label key={key} className="text-sm">{label}<input type="number" min={0} max={10} value={counts[key]} className={input+' mt-1'}
                onChange={(event) => setCounts({...counts,[key]:Number(event.target.value)})}/></label>)}
            <label className="text-sm">Content<select className={input+' mt-1'} value={counts.section||''}
              onChange={(event) => setCounts({...counts,section:event.target.value||null})}>
              <option value="">Whole lecture</option>{lecture?.sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
            </select></label>
          </div>
          <button className={button+' bg-secondary text-white'} disabled={!ready||busy||Boolean(pending)} onClick={generate}>Generate lecture questions</button>
          {quizzes.length>0 && <label className="block text-sm">Saved question sets<select className={input+' mt-1'} value={quiz?.id||''} onChange={(event) => {if(event.target.value)openQuiz(event.target.value);}}>
            <option value="">Choose a saved set</option>{quizzes.map((item) => <option key={item.id} value={item.id}>{new Date(item.created_at).toLocaleString()}</option>)}
          </select></label>}
          {quiz && <form onSubmit={submit} className="space-y-5">
            {quiz.questions.map((item,index) => {
              const feedback=attempt?.feedback.find((entry) => entry.id===item.id);
              return <fieldset key={item.id} className="border border-border p-4">
                <legend dir="auto" className="font-semibold px-1">{index+1}. {item.prompt}</legend>
                {item.type==='mcq' && item.choices.map((choice,index) => <label dir="auto" className="flex gap-2 mt-2" key={index}>
                  <input type="radio" disabled={Boolean(attempt)} name={item.id} checked={answers[item.id]===index} onChange={() => setAnswers({...answers,[item.id]:index})}/>{choice}</label>)}
                {item.type==='tf' && [[true,'True'],[false,'False']].map(([value,label]) => <label className="flex gap-2 mt-2" key={label}>
                  <input type="radio" disabled={Boolean(attempt)} name={item.id} checked={answers[item.id]===value} onChange={() => setAnswers({...answers,[item.id]:value})}/>{label}</label>)}
                {item.type==='essay' && <textarea disabled={Boolean(attempt)} aria-label={'Essay answer '+(index+1)} dir="auto" maxLength={4000} className={input}
                  value={answers[item.id]||''} onChange={(event) => setAnswers({...answers,[item.id]:event.target.value})}/>}
                {feedback && <div className="mt-4 p-3 bg-secondary/10" dir="auto">
                  <p className="font-bold">{feedback.correct===null?'Self-assessment':feedback.correct?'Correct':'Review this answer'}</p>
                  <p>Answer: {feedback.type==='mcq'?feedback.choices[feedback.answer]:String(feedback.answer)}</p>
                  <p className="mt-2">{feedback.explanation}</p>
                  {feedback.rubric?.length>0 && <ul className="list-disc pl-5">{feedback.rubric.map((point) => <li key={point}>{point}</li>)}</ul>}
                  {references(feedback.citations)}
                  <button type="button" disabled={false} className={button+' mt-2'} onClick={() => {
                    setQuestion('Explain the answer to this lecture question: '+item.prompt);setTab('chat');
                  }}>Explain this answer in lecture chat</button>
                </div>}
              </fieldset>;
            })}
            {!attempt && <button className={button+' bg-secondary text-white'} disabled={busy||quiz.questions.some((item) => answers[item.id]===undefined)}>Submit practice answers</button>}
            {attempt && <div role="status" className="bg-green-50 p-4">Objective score: {attempt.score}/{attempt.total}. Essays use self-assessment.
              <button type="button" className={button+' ml-2'} onClick={() => {setAttempt(null);setAnswers({});}}>Try again</button></div>}
          </form>}
          {attempts.length>0 && <aside aria-label="Practice history"><h3 className="font-bold">Your previous attempts</h3>
            {attempts.map((item) => <p key={item.id} className="text-sm mt-2">{new Date(item.created_at).toLocaleString()} · {item.score}/{item.total}</p>)}</aside>}
        </>}
        {tab==='transcript' && lecture && (!hasTranscript ? <p className="text-sm text-light-accent/60">The transcript appears here once the lecture has been transcribed.</p>
          : transcript.state==='ready' ? (transcript.cleaned || transcript.raw
            ? <TranscriptView cleaned={transcript.cleaned} raw={transcript.raw} title={lecture.title} language={lecture.language}/>
            : <p className="text-sm text-light-accent/60">This lecture has no stored transcript.</p>)
          : transcript.state==='error' ? <div role="alert" className="p-3 bg-red-50 text-red-700 text-sm">{transcript.error}
            <button type="button" className={button+' ml-2'} onClick={() => setTranscript({state:'idle'})}><RotateCcw size={14}/>Try again</button></div>
          : <p><Loader2 className="inline animate-spin" size={16}/> Loading the transcript...</p>)}
        {tab==='sources' && <div className="space-y-3">
          {lecture?.chunks.length>0 && <p className="text-xs text-light-accent/60">The passages that answers and questions cite. Neighbouring passages overlap; the Transcript tab has the full text.</p>}
          {lecture?.chunks.map((chunk) =>
          <article key={chunk.id} id={'source-'+chunk.id} dir={textDirection(chunk.text)} className={'border p-4 whitespace-pre-wrap leading-7 '+(sourceId===chunk.id?'border-accent bg-secondary/10':'border-border')}>
            <p className="text-xs text-accent mb-2">Source {chunk.id}</p>{chunk.text}</article>)}</div>}
      </div>
    </section>
  </div>;
}
