const { createHash } = require('node:crypto');
const study = require('../lectureStudy/store');
const learning = require('../lectureStudy/database');
const legacy = require('../db/appStore');
const { requestUpstream } = require('../lib/upstream');
const { fail } = require('./contracts');

// Existing study chunks are used verbatim. Plain transcripts use bounded overlapping
// excerpts, with even coverage of the entire source rather than truncating its tail.
function chunksFromText(text) {
  const chunks=[];
  for(let offset=0;offset<text.length;offset+=1400) chunks.push({id:`text-${chunks.length+1}`,text:text.slice(offset,offset+1600),section:'Material'});
  return chunks;
}
function boundedContext(chunks, summary='') {
  const valid=chunks.filter(c=>typeof c.text==='string'&&c.text.trim());
  if(!valid.length) fail(400,'This material has no readable text');
  const count=Math.min(24,valid.length);
  const selected=Array.from({length:count},(_,i)=>valid[count===1?0:Math.round(i*(valid.length-1)/(count-1))]);
  return {summary:String(summary||'').slice(0,6000),chunks:selected.map(c=>({id:String(c.id),section:String(c.section||''),text:c.text.slice(0,1800)})),total_chunks:valid.length};
}
async function resolveMaterial(user,source) {
  if(source.kind==='lecture') {
    if(!learning.enabled()) fail(503,'Lecture library is unavailable');
    const lecture=await study.getLecture(user,source.id);
    if(lecture.status!=='ready') fail(409,'Wait for this lecture to finish processing');
    return {source,title:lecture.title,context:boundedContext(lecture.chunks,lecture.summary)};
  }
  if(source.kind==='transcript') {
    if(!await legacy.ownsJob(user,source.id)) fail(404,'Material not found');
    const base=String(process.env.LECTURESCRIBE_API_URL||'https://lecturescribe.app').replace(/\/+$/,'');
    const response=await requestUpstream(null,`${base}/jobs/${encodeURIComponent(source.id)}/transcript?kind=cleaned`,{},{timeoutMs:30000,maxBytes:1024*1024});
    if(!response.ok) fail(409,'The transcript is not ready. Try a completed lecture.');
    const text=await response.text();
    if(text.trim().length<100) fail(400,'This transcript has too little readable content');
    const jobs=await legacy.listJobs(user);
    return {source,title:jobs.find(j=>j.job_id===source.id)?.title||'Lecture transcript',context:boundedContext(chunksFromText(text))};
  }
  if(source.text.includes('\u0000')||!/[\p{L}]/u.test(source.text)) fail(400,'Choose a readable UTF-8 text document');
  return {source:{kind:'text',digest:createHash('sha256').update(source.text).digest('hex')},title:source.title,context:boundedContext(chunksFromText(source.text))};
}
module.exports={boundedContext,chunksFromText,resolveMaterial};
