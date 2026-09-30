import {useRef,useState} from 'react';
import {FileText,UploadCloud,X,AlertTriangle,CheckCircle} from 'lucide-react';
import {oralExamService as api} from '../../services/oralExam';

// Must match the server limits in backend/src/oralExam/ingest.
export const MAX_UPLOAD_BYTES=4*1024*1024;
export const MAX_MATERIAL_CHARS=90000;
// The examiner reads up to 24 evenly spaced ~1,400-character passages.
const SAMPLED_AFTER=24*1400;
const ACCEPT='.pdf,.docx,.pptx,.txt,.md,.markdown,application/pdf,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation';

export const formatSize=bytes=>bytes<1024?`${bytes} B`:bytes<1024*1024?`${Math.round(bytes/1024)} KB`:`${(bytes/1024/1024).toFixed(1)} MB`;
const count=n=>n.toLocaleString('en-US');
const unitLabel=units=>units?`${units.count} ${units.kind}${units.count===1?'':'s'}`:null;
const errorText=e=>e.response?.data?.error||(e.code==='ECONNABORTED'?'The upload took too long. Check your connection and try again.':e.response?'This file could not be processed. Try again or paste the text instead.':'The file could not be uploaded. Check your connection and try again.');

export default function MaterialUpload({onExtracted,onCleared,disabled}){
  const [file,setFile]=useState(null),[phase,setPhase]=useState('idle'),[progress,setProgress]=useState(0),[error,setError]=useState(''),[material,setMaterial]=useState(null),[dragging,setDragging]=useState(false);
  const input=useRef(null),abort=useRef(null);
  const busy=phase==='uploading'||phase==='extracting';
  async function choose(next){
    if(!next||busy)return;
    setFile({name:next.name,size:next.size});setError('');setMaterial(null);setProgress(0);
    if(next.size>MAX_UPLOAD_BYTES){setPhase('error');setError(`This file is ${formatSize(next.size)}. The limit is 4 MB; upload a smaller file or only the chapters you need.`);return;}
    if(!next.size){setPhase('error');setError('This file is empty.');return;}
    const controller=new AbortController();abort.current=controller;setPhase('uploading');
    try{
      const {data}=await api.extract(next,{signal:controller.signal,onUploadProgress:e=>{
        if(e.total)setProgress(Math.round(e.loaded/e.total*100));
        if(!e.total||e.loaded>=e.total)setPhase('extracting');
      }});
      setMaterial(data.material);setPhase('done');onExtracted(data.material);
    }catch(e){
      if(controller.signal.aborted){setPhase('idle');setFile(null);return;}
      setPhase('error');setError(errorText(e));
    }finally{abort.current=null;if(input.current)input.current.value='';}
  }
  function clear(){abort.current?.abort();setFile(null);setMaterial(null);setError('');setPhase('idle');if(input.current)input.current.value='';if(material)onCleared();}
  const drop=e=>{e.preventDefault();setDragging(false);if(!disabled)choose(e.dataTransfer.files?.[0]);};
  const cut=material?.truncation;
  return <div className="oral-upload">
    <span className="oral-upload-label" id="oral-upload-label">Upload study material</span>
    <p className="oral-hint" id="oral-upload-formats">PDF, Word (.docx), PowerPoint (.pptx), Markdown or plain text · up to 4 MB. Scanned PDFs, images and older .doc or .ppt files cannot be read yet.</p>
    {!file&&<label className={`oral-dropzone ${dragging?'is-dragging':''}`} onDragOver={e=>{e.preventDefault();setDragging(true);}} onDragLeave={()=>setDragging(false)} onDrop={drop}>
      <UploadCloud size={28} aria-hidden="true"/>
      <span><strong>Choose a file</strong> or drag it here</span>
      <input ref={input} className="oral-visually-hidden" type="file" accept={ACCEPT} disabled={disabled} aria-labelledby="oral-upload-label" aria-describedby="oral-upload-formats" onChange={e=>choose(e.target.files?.[0])}/>
    </label>}
    {file&&<div className={`oral-file ${phase==='error'?'is-error':''}`} aria-live="polite">
      <div className="oral-file-row">
        <FileText size={22} aria-hidden="true"/>
        <div className="oral-file-name"><strong>{file.name}</strong><span className="oral-hint">{formatSize(file.size)}{material&&` · ${material.format_label}${unitLabel(material.units)?` · ${unitLabel(material.units)}`:''}`}</span></div>
        {busy
          ?<button type="button" className="btn-secondary" onClick={clear}>Cancel</button>
          :<button type="button" className="oral-file-remove" onClick={clear} aria-label={`Remove ${file.name}`}><X size={18}/></button>}
      </div>
      {phase==='uploading'&&<div role="status"><progress value={progress} max="100" aria-label="Upload progress"/> <span className="oral-hint">Uploading… {progress}%</span></div>}
      {phase==='extracting'&&<div role="status"><progress aria-label="Reading document"/> <span className="oral-hint">Reading the document and extracting its text…</span></div>}
      {phase==='error'&&<p className="oral-file-error" role="alert"><AlertTriangle size={16} aria-hidden="true"/> {error}</p>}
      {phase==='done'&&material&&<div className="oral-file-summary">
        <p><CheckCircle size={16} aria-hidden="true"/> Extracted {count(material.characters)} characters. The text below is exactly what the exam will use; you can review and edit it.</p>
        {cut&&<p className="oral-file-warning" role="status"><AlertTriangle size={16} aria-hidden="true"/> This document is longer than the {count(MAX_MATERIAL_CHARS)}-character exam limit. {cut.kept_units?`Only ${cut.kept_units.kind}s ${cut.kept_units.from}–${cut.kept_units.to} of ${cut.kept_units.of} are included`:`Only the first ${count(cut.kept_characters)} of ${count(cut.original_characters)} characters are included`}. Upload the remaining part separately to be examined on it.</p>}
        {material.characters>SAMPLED_AFTER&&<p className="oral-hint">Long material: questions are drawn from evenly spaced passages across the whole text.</p>}
      </div>}
      {!busy&&<button type="button" className="oral-file-change" onClick={()=>{clear();setTimeout(()=>input.current?.click());}}>{phase==='error'?'Choose another file':'Change file'}</button>}
    </div>}
  </div>;
}
