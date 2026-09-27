import { useCallback, useEffect, useState } from 'react';
import { BookOpen, ListChecks, MessageSquare, RefreshCw, Trash2 } from 'lucide-react';
import LectureWorkspace from './LectureWorkspace';
import { lectureStudyService as service } from '../../services/lectureStudy';
import { studentService } from '../../services/api';
const button='inline-flex items-center gap-2 border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-40';

export function LectureCourseSelect({enabled,value,onChange}) {
  const [courses,setCourses]=useState([]);
  useEffect(() => {
    let user;
    try {user=JSON.parse(localStorage.getItem('user')||'{}');} catch {return;}
    if (!enabled || user.role!=='student') return;
    const controller=new AbortController();
    studentService.getPredictionData({signal:controller.signal}).then(({data}) => {
      if (!controller.signal.aborted) setCourses(data.enrollments||[]);
    }).catch(() => {});
    return () => controller.abort();
  },[enabled]);
  if (!enabled || !courses.length) return null;
  return <label className="block text-sm font-semibold">Course for study recommendations
    <select className="block mt-2 border border-border p-2" value={value||''} onChange={(event) => onChange(event.target.value?Number(event.target.value):null)}>
      <option value="">Personal lecture</option>{courses.map((course) => <option key={course.enrollment_id} value={course.enrollment_id}>{course.code_module} · {course.code_presentation}</option>)}
    </select>
  </label>;
}

export default function LectureLibrary({focusLecture,onAvailabilityChange}) {
  const [status,setStatus]=useState(null);
  const [lectures,setLectures]=useState([]);
  const [offset,setOffset]=useState(0);
  const [opened,setOpened]=useState(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const close=useCallback(() => setOpened(null),[]);
  const load=useCallback(async () => {
    setBusy(true);
    try {
      const {data}=await service.status();setStatus(data);onAvailabilityChange?.(data.enabled);
      if (data.enabled) {const result=await service.list(offset);setLectures(result.data.lectures);}
      setError('');
    } catch(error) {setError(error.response?.data?.error||'Saved lecture tools are temporarily unavailable.');}
    finally {setBusy(false);}
  },[offset,onAvailabilityChange]);
  useEffect(() => {
    let alive=true;
    const initialize=async () => {
      try {
        const {data}=await service.status();
        if (!alive) return;
        setStatus(data);onAvailabilityChange?.(data.enabled);
        if (data.enabled) {
          const response=await service.list(offset);
          if (alive) {setLectures(response.data.lectures);setError('');}
        }
      } catch(error) {if(alive)setError(error.response?.data?.error||'Saved lecture tools are temporarily unavailable.');}
    };
    initialize();
    const timer=setInterval(() => {if(!document.hidden&&alive)initialize();},15000);
    return () => {alive=false;clearInterval(timer);};
  },[offset,onAvailabilityChange]);
  useEffect(() => {
    if (focusLecture?.id) {setOpened(focusLecture);load();}
  },[focusLecture,load]);
  return <section className="glass glow-border p-5 space-y-4" aria-label="Saved lecture library">
    <header className="flex items-center justify-between gap-3">
      <div><h2 className="font-display text-xl font-semibold">{status?.enabled ? 'Your saved lectures' : 'Lecture library'}</h2>
        <p className="text-sm text-light-accent/60 mt-1">{status?.enabled ? "Revisit your notes, ask questions and practise at your own pace." : "Saved lecture access is separate from the transcription service."}</p></div>
      <button type="button" className={button} onClick={load} disabled={busy} aria-label="Refresh saved lectures"><RefreshCw size={16}/></button>
    </header>
    {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
    {status?.enabled===false && <p className="text-sm text-light-accent/60">Saved lecture tools are not enabled yet. Check transcription availability below.</p>}
    {status?.enabled && !status.worker_online && <p role="status" className="text-sm bg-amber-50 p-3">Local processing is offline. Saved content and completed practice remain available; new AI requests wait in the queue.</p>}
    {status?.storage_warning && <p role="status" className="text-sm text-amber-700">Learning storage is approaching its free capacity.</p>}
    {status?.enabled && !lectures.length && <p className="text-sm text-light-accent/60">Add a lecture using the form below, or save a completed transcript using its chat or questions button.</p>}
    <div className="grid md:grid-cols-2 gap-3">{lectures.map((lecture) => <article key={lecture.id} className="rounded-xl border border-border p-4">
      <h3 className="font-semibold break-words">{lecture.title}</h3>
      <p className="text-xs text-light-accent/60 mt-1">{lecture.status} · {lecture.stage}</p>
      <div className="flex flex-wrap gap-2 mt-3">
        <button className={button} onClick={() => setOpened({id:lecture.id,tab:'summary'})}><BookOpen size={15}/>Summary</button>
        <button className={button} onClick={() => setOpened({id:lecture.id,tab:'chat'})}><MessageSquare size={15}/>Ask this lecture</button>
        <button className={button} onClick={() => setOpened({id:lecture.id,tab:'quiz'})}><ListChecks size={15}/>Generate questions</button>
        <button className={button} aria-label={'Remove '+lecture.title+' from library'} onClick={async () => {
          try {await service.remove(lecture.id);await load();} catch(error){setError(error.response?.data?.error||'Unable to remove lecture');}
        }}><Trash2 size={15}/></button>
      </div>
    </article>)}</div>
    {status?.enabled && <div className="flex gap-2">
      <button className={button} disabled={offset===0} onClick={() => setOffset(Math.max(0,offset-20))}>Previous</button>
      <button className={button} disabled={lectures.length<20} onClick={() => setOffset(offset+20)}>Next</button>
    </div>}
    {opened && <LectureWorkspace key={opened.id} lectureId={opened.id} initialTab={opened.tab} onClose={close}/>}
  </section>;
}
