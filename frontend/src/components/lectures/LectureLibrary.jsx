import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, ListChecks, MessageSquare, RefreshCw, Trash2, Users } from 'lucide-react';
import LectureWorkspace from './LectureWorkspace';
import AdminLectureViewer from './AdminLectureViewer';
import { ownerName } from './AdminLectureSaves';
import ConfirmDialog from '../ui/ConfirmDialog';
import {useAuth} from '../../context/AuthContext';
import { lectureStudyService as service } from '../../services/lectureStudy';
import { studentService } from '../../services/api';
const button='inline-flex items-center gap-2 border border-border px-3 py-2 text-sm hover:border-accent disabled:opacity-40';
// New lectures go to the study queue only while a worker can prepare them; otherwise
// the page transcribes directly (LectureScribe) and the library can import it later.
const available=(status)=>Boolean(status?.enabled&&status?.worker_online);
const memberName=(member)=>member.type==='student'&&member.name?`${member.name} (#${member.id})`:ownerName(member);
/** "Saved by Amal (#800), Badr (#801) +3" for an administrator's lecture card.
 *  Members who removed the lecture (`removed_at`) are kept by the API for the record
 *  but are not counted or named as current savers. */
export const savedBy=(lecture)=>{
  const members=(lecture.members||[]).filter(member=>!member.removed_at),shown=members.slice(0,3).map(memberName);
  const more=Math.max(0,(lecture.member_count??members.length)-shown.length);
  return shown.length?'Saved by '+shown.join(', ')+(more?` +${more}`:''):more?`Saved by ${more} account${more===1?'':'s'}`:'Not in any library now';
};

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
  const {user}=useAuth();
  const isAdmin=user?.role==='admin';
  const [scope,setScope]=useState(isAdmin?'all':'mine');
  const global=isAdmin&&scope==='all';
  const [status,setStatus]=useState(null);
  const [lectures,setLectures]=useState([]);
  const [offset,setOffset]=useState(0);
  const [opened,setOpened]=useState(null);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [removing,setRemoving]=useState(null);
  const [removeBusy,setRemoveBusy]=useState(false);
  const close=useCallback(() => setOpened(null),[]);
  const load=useCallback(async () => {
    setBusy(true);
    try {
      const {data}=await service.status();setStatus(data);onAvailabilityChange?.(available(data));
      if (data.enabled) {const result=await (global?service.adminList(offset):service.list(offset));setLectures(result.data.lectures);}
      setError('');
    } catch(error) {setError(error.response?.data?.error||'Saved lecture tools are temporarily unavailable.');}
    finally {setBusy(false);}
  },[offset,onAvailabilityChange,global]);
  useEffect(() => {
    let alive=true;
    const initialize=async () => {
      try {
        const {data}=await service.status();
        if (!alive) return;
        setStatus(data);onAvailabilityChange?.(available(data));
        if (data.enabled) {
          const response=await (global?service.adminList(offset):service.list(offset));
          if (alive) {setLectures(response.data.lectures);setError('');}
        }
      } catch(error) {if(alive)setError(error.response?.data?.error||'Saved lecture tools are temporarily unavailable.');}
    };
    initialize();
    const timer=setInterval(() => {if(!document.hidden&&alive)initialize();},15000);
    return () => {alive=false;clearInterval(timer);};
  },[offset,onAvailabilityChange,global]);
  // A lecture the page asks to show is opened once: paging, changing scope or
  // closing the drawer must not reopen it.
  const loadLatest=useRef(load);
  loadLatest.current=load;
  const focused=useRef(null);
  useEffect(() => {
    if (!focusLecture?.id || focused.current===focusLecture) return;
    focused.current=focusLecture;
    setOpened(focusLecture);
    if(global)setScope('mine');else loadLatest.current();
  },[focusLecture,global]);
  const remove=async () => {
    if(!removing)return;
    setRemoveBusy(true);
    try {await service.remove(removing.id);setRemoving(null);if(opened?.id===removing.id)setOpened(null);await load();}
    catch(error){setRemoving(null);setError(error.response?.data?.error||'Unable to remove lecture');}
    finally{setRemoveBusy(false);}
  };
  if(!error&&!status?.enabled)return null;
  return <section className="glass glow-border p-5 space-y-4" aria-label="Saved lecture library">
    <header className="flex items-center justify-between gap-3">
      <div><h2 className="font-display text-xl font-semibold">{global?'All saved lectures':'Your saved lectures'}</h2>
        <p className="text-sm text-light-accent/60 mt-1">{global?'View lecture summaries and transcripts across all accounts.':'Revisit your notes, ask questions and practise at your own pace.'}</p></div>
      <button type="button" className={button} onClick={load} disabled={busy} aria-label="Refresh saved lectures"><RefreshCw size={16}/></button>
    </header>
    {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
    {isAdmin&&<nav aria-label="Lecture library scope" className="flex flex-wrap gap-2">
      {[['all','All lectures'],['mine','My study library']].map(([value,label])=><button type="button" key={value} className={button}
        aria-pressed={scope===value} onClick={()=>{setScope(value);setOffset(0);setOpened(null);}}>{label}</button>)}
    </nav>}
    {status?.enabled && !status.worker_online && <p role="status" className="text-sm bg-amber-50 p-3">Local processing is offline. Saved content and completed practice remain available; new AI requests wait in the queue.</p>}
    {status?.storage_warning && <p role="status" className="text-sm text-amber-700">Learning storage is approaching its free capacity.</p>}
    {status?.enabled && !lectures.length && <p className="text-sm text-light-accent/60">Add a lecture using the form below, or save a completed transcript using its chat or questions button.</p>}
    <div className="grid md:grid-cols-2 gap-3">{lectures.map((lecture) => <article key={lecture.id} className="rounded-xl border border-border p-4">
      <h3 dir="auto" className="font-semibold break-words">{lecture.title}</h3>
      <p className="text-xs text-light-accent/60 mt-1">{lecture.status} · {lecture.stage}</p>
      {global&&<p className="text-xs text-light-accent/70 mt-1 flex items-start gap-1.5"><Users size={13} className="mt-0.5 shrink-0" aria-hidden="true"/><span className="min-w-0 break-words">{savedBy(lecture)}</span></p>}
      <div className="flex flex-wrap gap-2 mt-3">
        {global?<button className={button} onClick={()=>setOpened({id:lecture.id,admin:true})}><BookOpen size={15}/>View transcript and summary</button>:<>
        <button className={button} onClick={() => setOpened({id:lecture.id,tab:'summary'})}><BookOpen size={15}/>Summary</button>
        <button className={button} onClick={() => setOpened({id:lecture.id,tab:'chat'})}><MessageSquare size={15}/>Ask this lecture</button>
        <button className={button} onClick={() => setOpened({id:lecture.id,tab:'quiz'})}><ListChecks size={15}/>Generate questions</button>
        <button className={button} aria-label={'Remove '+lecture.title+' from library'} onClick={() => setRemoving(lecture)}><Trash2 size={15}/></button>
        </>}
      </div>
    </article>)}</div>
    {status?.enabled && <div className="flex gap-2">
      <button className={button} disabled={offset===0} onClick={() => setOffset(Math.max(0,offset-20))}>Previous</button>
      <button className={button} disabled={lectures.length<20} onClick={() => setOffset(offset+20)}>Next</button>
    </div>}
    {opened && (opened.admin?<AdminLectureViewer key={opened.id} lectureId={opened.id} onClose={close}/>:<LectureWorkspace key={opened.id} lectureId={opened.id} initialTab={opened.tab} onClose={close}/>)}
    <ConfirmDialog open={Boolean(removing)} title="Remove this lecture from your library?" confirmLabel="Remove lecture" busy={removeBusy}
      description={`"${removing?.title||''}" will leave your library, with your chat, practice questions and attempts for it. You can add the lecture again later.`}
      onConfirm={remove} onCancel={() => setRemoving(null)}/>
  </section>;
}
