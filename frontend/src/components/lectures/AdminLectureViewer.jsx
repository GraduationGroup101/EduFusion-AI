import {useEffect,useRef,useState} from 'react';
import {Users,X} from 'lucide-react';
import TranscriptView from './TranscriptView';
import {Paragraphs,transcriptVersions} from './LectureWorkspace';
import {formatWhen,languageName,ownerName} from './AdminLectureSaves';
import {lectureStudyService as service} from '../../services/lectureStudy';

const memberDetail=(member)=>member.type==='student'?'Student ID '+member.id:[member.role&&member.role[0].toUpperCase()+member.role.slice(1),member.email].filter(Boolean).join(' · ');

export default function AdminLectureViewer({lectureId,onClose}) {
  const [lecture,setLecture]=useState(null),[error,setError]=useState(''),[tab,setTab]=useState('transcript');
  const panel=useRef(null);
  // The latest close handler, so a parent re-render never re-runs the focus trap.
  const close=useRef(onClose);
  close.current=onClose;
  useEffect(()=>{
    const controller=new AbortController();
    service.adminLecture(lectureId,controller.signal).then(({data})=>{if(!controller.signal.aborted)setLecture(data.lecture);})
      .catch(error=>{if(!controller.signal.aborted)setError(error.response?.data?.error||'Unable to load this lecture.');});
    return()=>controller.abort();
  },[lectureId]);
  useEffect(()=>{
    const previous=document.activeElement,overflow=document.body.style.overflow;
    document.body.style.overflow='hidden';panel.current?.focus();
    const keydown=event=>{
      if(event.key==='Escape')close.current();
      if(event.key!=='Tab')return;
      const buttons=[...panel.current.querySelectorAll('button,a[href]')],first=buttons[0],last=buttons.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keydown);
    return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keydown);previous?.focus();};
  },[]);
  const versions=transcriptVersions(lecture);
  // Current savers first, then members who removed the lecture since (kept for the record).
  const allMembers=lecture?.members||[];
  const members=[...allMembers.filter(member=>!member.removed_at),...allMembers.filter(member=>member.removed_at)];
  const savedCount=lecture?.member_count??allMembers.filter(member=>!member.removed_at).length;
  return <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={lecture?.title||'Lecture transcript'}
      onClick={event=>event.stopPropagation()} className="bg-white w-full min-w-0 md:max-w-4xl h-full flex flex-col shadow-xl outline-none">
      <header className="p-5 border-b border-border flex justify-between items-start gap-3">
        <div className="min-w-0"><h2 dir="auto" className="font-display text-xl font-semibold break-words">{lecture?.title||'Loading lecture'}</h2>
          <p className="text-sm text-muted mt-1">Lecture content for administration. Student conversations and practice stay private.</p></div>
        <button type="button" className="icon-button" aria-label="Close lecture transcript" onClick={onClose}><X size={20}/></button>
      </header>
      <nav aria-label="Lecture content" className="p-3 flex flex-wrap gap-2 border-b border-border">
        {[['transcript','Transcript'],['summary','Summary']].map(([key,label])=>
          <button key={key} type="button" className={'rounded-lg border border-border px-3 py-2 text-sm '+(tab===key?'bg-secondary text-white':'')}
            aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4 break-words">
        {error&&<p role="alert">{error}</p>}
        {!lecture&&!error&&<p>Loading lecture content…</p>}
        {lecture&&<>
          <p className="text-sm text-light-accent/70">
            <a className="text-secondary underline break-all" href={lecture.youtube_url} target="_blank" rel="noreferrer">{lecture.youtube_url}</a>
            {lecture.language&&<span> · {languageName(lecture.language)}</span>}<span> · {lecture.status}</span>
          </p>
          <section aria-label="Saved by" className="rounded-xl border border-border p-4">
            <h3 className="flex items-center gap-2 text-sm font-semibold"><Users size={16} aria-hidden="true"/>
              Saved by {savedCount} account{savedCount===1?'':'s'}</h3>
            {members.length?<ul className="mt-3 divide-y divide-border text-sm">{members.map(member=><li key={member.owner_key} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2">
              <span className="min-w-0"><span dir="auto" className="font-medium">{ownerName(member)}</span>
                {memberDetail(member)&&<span className="text-light-accent/60"> · {memberDetail(member)}</span>}</span>
              <span className="text-xs text-light-accent/60">{member.removed_at
                ?<>Saved {formatWhen(member.saved_at)} · <span className="font-semibold">Removed {formatWhen(member.removed_at)}</span></>
                :formatWhen(member.saved_at)}</span>
            </li>)}</ul>:<p className="mt-2 text-sm text-light-accent/60">No account has this lecture in its library now.</p>}
          </section>
          {tab==='transcript'&&(versions.cleaned||versions.raw
            ?<TranscriptView cleaned={versions.cleaned} raw={versions.raw} title={lecture.title} language={lecture.language}/>
            :<p>This content is not ready yet.</p>)}
          {tab==='summary'&&(lecture.summary?<Paragraphs text={lecture.summary}/>:<p>This content is not ready yet.</p>)}
        </>}
      </div>
    </section>
  </div>;
}
