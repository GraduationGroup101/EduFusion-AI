import {useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {lectureStudyService as service} from '../../services/lectureStudy';
export default function AdminLectureViewer({lectureId,onClose}) {
  const [lecture,setLecture]=useState(null),[error,setError]=useState(''),[tab,setTab]=useState('transcript');
  const panel=useRef(null);
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
      if(event.key==='Escape')onClose();
      if(event.key!=='Tab')return;
      const buttons=[...panel.current.querySelectorAll('button,a[href]')],first=buttons[0],last=buttons.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===panel.current)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    };
    document.addEventListener('keydown',keydown);
    return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',keydown);previous?.focus();};
  },[onClose]);
  const text=tab==='summary'?lecture?.summary:tab==='raw'?lecture?.raw_transcript:lecture?.transcript;
  return <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label={lecture?.title||'Lecture transcript'}
      onClick={event=>event.stopPropagation()} className="bg-white w-full md:max-w-4xl h-full flex flex-col shadow-xl outline-none">
      <header className="p-5 border-b border-border flex justify-between items-start gap-3">
        <div><h2 className="font-display text-xl font-semibold">{lecture?.title||'Loading lecture'}</h2>
          <p className="text-sm text-muted mt-1">Lecture content for administration. Student conversations and practice stay private.</p></div>
        <button type="button" className="icon-button" aria-label="Close lecture transcript" onClick={onClose}><X size={20}/></button>
      </header>
      <nav aria-label="Lecture content" className="p-3 flex flex-wrap gap-2 border-b border-border">
        {[['transcript','Transcript'],['raw','Original transcript'],['summary','Summary']].map(([key,label])=>
          <button key={key} type="button" className={'rounded-lg border border-border px-3 py-2 text-sm '+(tab===key?'bg-secondary text-white':'')}
            aria-pressed={tab===key} onClick={()=>setTab(key)}>{label}</button>)}
      </nav>
      <div className="flex-1 overflow-y-auto p-5 space-y-4">
        {error&&<p role="alert">{error}</p>}
        {lecture&&<a className="text-secondary underline break-all text-sm" href={lecture.youtube_url} target="_blank" rel="noreferrer">{lecture.youtube_url}</a>}
        <div dir="auto" className="whitespace-pre-wrap leading-7 break-words">{text||(!lecture&&!error?'Loading lecture content…':'This content is not ready yet.')}</div>
      </div>
    </section>
  </div>;
}
