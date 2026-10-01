import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, ListChecks, Mic, Send, X, Loader2, Trash2, Sparkles } from 'lucide-react';
import { lectureToolsService as service } from '../../services/lectureTools';

const message = (error) => error.response?.data?.error || 'The lecture assistant is unavailable right now. Please try again.';
const button = 'inline-flex items-center gap-2 border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-40';
const input = 'w-full border border-border bg-white p-3 text-sm outline-none focus:border-accent';
const jobTitle = (job) => job?.title || job?.result?.title || job?.request?.youtube_url || 'Lecture transcript';

// Chat and practice questions over one saved transcript. Unlike the optional
// local lecture library, this works on the hosted gateway with only a model key.
export default function LectureToolsPanel({ job, initialTab = 'chat', onClose }) {
  const jobId = job.job_id;
  const [tab, setTab] = useState(initialTab);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [quizzes, setQuizzes] = useState([]);
  const [quiz, setQuiz] = useState(null);
  const [answers, setAnswers] = useState({});
  const [checked, setChecked] = useState(false);
  const [counts, setCounts] = useState({ num_mcq: 4, num_tf: 3, num_essay: 1, language: 'auto' });
  const panel = useRef(null);
  const alive = useRef(true);
  const log = useRef(null);
  // The parent may pass a new onClose on every render: read it through a ref so the
  // focus/scroll-lock effect runs once and never pulls focus away from the inputs.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    const keydown = (event) => { if (event.key === 'Escape') closeRef.current?.(); };
    document.addEventListener('keydown', keydown);
    return () => { document.body.style.overflow = overflow; document.removeEventListener('keydown', keydown); previous?.focus?.(); };
  }, []);
  useEffect(() => {
    alive.current = true;
    setTab(initialTab); setMessages([]); setQuizzes([]); setQuiz(null); setAnswers({}); setChecked(false); setError('');
    const controller = new AbortController();
    Promise.allSettled([service.history(jobId, controller.signal), service.quizzes(jobId, controller.signal)]).then((results) => {
      if (!alive.current || controller.signal.aborted) return;
      if (results[0].status === 'fulfilled') setMessages(results[0].value.data.messages || []);
      if (results[1].status === 'fulfilled') { const saved = results[1].value.data.quizzes || []; setQuizzes(saved); if (saved[0]) setQuiz(saved[0]); }
      const failure = results.find((result) => result.status === 'rejected');
      if (failure) setError(message(failure.reason));
    });
    return () => { alive.current = false; controller.abort(); };
  }, [jobId, initialTab]);
  useEffect(() => { log.current?.scrollTo?.({ top: log.current.scrollHeight }); }, [messages.length, busy]);

  const ask = async (event) => {
    event.preventDefault();
    const trimmed = question.trim();
    if (!trimmed || busy) return;
    setBusy(true); setError('');
    setMessages((current) => [...current, { role: 'user', content: trimmed, created_at: new Date().toISOString() }]);
    setQuestion('');
    try {
      const { data } = await service.ask(jobId, trimmed);
      if (!alive.current) return;
      setMessages((current) => [...current, { role: 'assistant', content: data.answer, sources: data.sources || [], covered: data.covered }]);
    } catch (requestError) {
      if (!alive.current) return;
      setError(message(requestError)); setQuestion(trimmed);
      setMessages((current) => current.slice(0, -1));
    } finally { if (alive.current) setBusy(false); }
  };
  const clear = async () => {
    try { await service.clear(jobId); if (alive.current) setMessages([]); }
    catch (requestError) { if (alive.current) setError(message(requestError)); }
  };
  const generate = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const { data } = await service.generate(jobId, counts);
      if (!alive.current) return;
      setQuizzes((current) => [data.quiz, ...current]); setQuiz(data.quiz); setAnswers({}); setChecked(false);
    } catch (requestError) { if (alive.current) setError(message(requestError)); }
    finally { if (alive.current) setBusy(false); }
  };
  const objective = quiz?.questions.filter((item) => item.type !== 'essay') || [];
  const score = objective.filter((item) => answers[item.id] === item.answer_index).length;
  return <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={jobTitle(job)}
      onClick={(event) => event.stopPropagation()} className="bg-white w-full min-w-0 md:max-w-3xl h-full flex flex-col shadow-xl outline-none">
      <header className="p-4 border-b border-border flex shrink-0 items-center justify-between gap-3">
        <div className="min-w-0"><h2 className="font-display text-lg font-bold truncate" dir="auto">{jobTitle(job)}</h2>
          <p className="text-xs text-light-accent/60">Answers and questions use this lecture's transcript only.</p></div>
        <button className={button} onClick={onClose} aria-label="Close lecture tools"><X size={18}/></button>
      </header>
      <nav className="p-3 flex shrink-0 flex-wrap gap-2 border-b border-border" aria-label="Lecture tools">
        {[['chat', 'Ask this lecture', MessageSquare], ['quiz', 'Practice questions', ListChecks]].map(([key, label, Icon]) =>
          <button key={key} className={button + (tab === key ? ' bg-secondary text-white' : '')} aria-pressed={tab === key} onClick={() => setTab(key)}><Icon size={16}/>{label}</button>)}
        <Link className={button} to={`/dashboard/oral-exam?transcript=${encodeURIComponent(jobId)}`} onClick={onClose}><Mic size={16}/>Oral exam on this lecture</Link>
      </nav>
      <div ref={log} className="min-h-0 min-w-0 flex-1 overflow-y-auto p-4 md:p-6 space-y-4 break-words">
        {error && <p role="alert" className="p-3 bg-red-50 text-red-700">{error}</p>}
        {tab === 'chat' && <>
          {!messages.length && <p className="text-sm text-light-accent/60">Ask anything about this lecture. Answers quote the transcript so you can verify them.</p>}
          {messages.map((item, index) => <article key={index} dir="auto" className={item.role === 'user' ? 'bg-secondary/10 p-3 whitespace-pre-wrap' : 'p-3 whitespace-pre-wrap border-b border-border'}>
            {item.content}
            {item.role === 'assistant' && item.sources?.length > 0 && <ul className="mt-2 space-y-1 text-xs text-light-accent/60" aria-label="Transcript quotes">
              {item.sources.map((quote, position) => <li key={position}>“{quote}”</li>)}</ul>}
          </article>)}
          {busy && <p role="status" className="text-sm text-light-accent/60"><Loader2 className="inline animate-spin" size={14}/> Reading the lecture…</p>}
        </>}
        {tab === 'quiz' && <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[['num_mcq', 'Multiple choice'], ['num_tf', 'True / false'], ['num_essay', 'Essay']].map(([key, label]) =>
              <label key={key} className="text-sm">{label}<input type="number" min={0} max={10} value={counts[key]} className={input + ' mt-1'}
                onChange={(event) => setCounts({ ...counts, [key]: Math.max(0, Math.min(10, Number(event.target.value) || 0)) })}/></label>)}
            <label className="text-sm">Language<select className={input + ' mt-1'} value={counts.language} onChange={(event) => setCounts({ ...counts, language: event.target.value })}>
              <option value="auto">Same as lecture</option><option value="ar">Arabic</option><option value="en">English</option></select></label>
          </div>
          <button className={button + ' bg-secondary text-white'} disabled={busy || counts.num_mcq + counts.num_tf + counts.num_essay === 0} onClick={generate}>
            {busy ? <Loader2 className="animate-spin" size={16}/> : <Sparkles size={16}/>}Generate questions</button>
          {quizzes.length > 1 && <label className="block text-sm">Saved question sets<select className={input + ' mt-1'} value={quiz?.id || ''}
            onChange={(event) => { const chosen = quizzes.find((item) => item.id === event.target.value); if (chosen) { setQuiz(chosen); setAnswers({}); setChecked(false); } }}>
            {quizzes.map((item) => <option key={item.id} value={item.id}>{new Date(item.created_at).toLocaleString()} · {item.questions.length} questions</option>)}</select></label>}
          {quiz && <form onSubmit={(event) => { event.preventDefault(); setChecked(true); }} className="space-y-5">
            {quiz.questions.map((item, index) => {
              const chosen = answers[item.id];
              const correct = checked && item.type !== 'essay' ? chosen === item.answer_index : null;
              return <fieldset key={item.id} className="border border-border p-4">
                <legend dir="auto" className="font-semibold px-1">{index + 1}. {item.prompt}</legend>
                {item.type !== 'essay' && item.choices.map((choice, position) => <label dir="auto" className="flex gap-2 mt-2" key={position}>
                  <input type="radio" disabled={checked} name={item.id} checked={chosen === position} onChange={() => setAnswers({ ...answers, [item.id]: position })}/>{choice}</label>)}
                {item.type === 'essay' && <textarea disabled={checked} aria-label={'Essay answer ' + (index + 1)} dir="auto" maxLength={4000} className={input}
                  value={chosen || ''} onChange={(event) => setAnswers({ ...answers, [item.id]: event.target.value })}/>}
                {checked && <div className="mt-4 p-3 bg-secondary/10" dir="auto">
                  <p className="font-bold">{correct === null ? 'Model answer' : correct ? 'Correct' : 'Review this answer'}</p>
                  <p>{item.type === 'essay' ? item.answer : item.choices[item.answer_index]}</p>
                  {item.explanation && <p className="mt-2 text-sm">{item.explanation}</p>}
                  <button type="button" className={button + ' mt-2'} onClick={() => { setQuestion('Explain this lecture question: ' + item.prompt); setTab('chat'); }}>Explain in lecture chat</button>
                </div>}
              </fieldset>;
            })}
            {!checked && <button className={button + ' bg-secondary text-white'} disabled={quiz.questions.some((item) => answers[item.id] === undefined || answers[item.id] === '')}>Check answers</button>}
            {checked && <div role="status" className="bg-green-50 p-4">{objective.length ? `Objective score: ${score}/${objective.length}. ` : ''}Essays are for self-review against the model answer.
              <button type="button" className={button + ' ml-2'} onClick={() => { setAnswers({}); setChecked(false); }}>Try again</button></div>}
          </form>}
        </>}
      </div>
      {tab === 'chat' && <form onSubmit={ask} className="p-3 border-t border-border flex shrink-0 gap-2">
        <textarea aria-label="Question about this lecture" dir="auto" rows={1} className={input} value={question} maxLength={2000}
          onChange={(event) => setQuestion(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(event); } }} placeholder="Ask about this lecture"/>
        <button className={button} disabled={busy || !question.trim()} aria-label="Send question"><Send size={16}/></button>
        {messages.length > 0 && <button type="button" className={button} disabled={busy} onClick={clear} aria-label="Clear this lecture conversation"><Trash2 size={16}/></button>}
      </form>}
    </section>
  </div>;
}
