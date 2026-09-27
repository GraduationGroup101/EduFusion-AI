const invalid = () => { throw new Error('Invalid lecture AI output'); };
const string = (value,max) => {if(typeof value!=='string'||!value.trim()||value.length>max)invalid();};
const citations = (value,allowed,required=true) => {
  if(!Array.isArray(value)||(required&&!value.length)||value.some(id=>typeof id!=='string'||!allowed.has(id)))invalid();
};
const preparation = (result) => {
  if(!result||!Array.isArray(result.chunks)||!result.chunks.length||result.chunks.length>500)invalid();
  const ids=new Set();
  for(const chunk of result.chunks){
    string(chunk.id,20);string(chunk.text,20000);string(chunk.section,100);
    if(ids.has(chunk.id)||!Number.isInteger(chunk.ordinal)||chunk.ordinal<0)invalid();
    ids.add(chunk.id);
    if(chunk.embedding!=null&&(!Array.isArray(chunk.embedding)||chunk.embedding.length!==384||chunk.embedding.some(value=>typeof value!=='number'||!Number.isFinite(value))))invalid();
  }
  if(!Array.isArray(result.sections)||!result.sections.length||!Array.isArray(result.concepts))invalid();
  for(const section of result.sections){
    string(section.id,100);string(section.title,200);string(section.summary,6000);
    citations(section.citations,new Set(result.chunks.filter(chunk=>chunk.section===section.id).map(chunk=>chunk.id)));
  }
  for(const concept of result.concepts)string(concept,200);
  string(result.summary,1024*1024);
};
const generated = (kind,result,chunks,counts) => {
  const allowed=new Set(chunks.map(chunk=>chunk.id));
  if(kind==='chat'){
    string(result?.answer,20000);citations(result.citations,allowed,false);return;
  }
  if(!Array.isArray(result?.questions)||!result.questions.length||result.questions.length>30)invalid();
  const actual={mcq:0,tf:0,essay:0},ids=new Set(),prompts=new Set();
  for(const item of result.questions){
    string(item.id,30);string(item.prompt,3000);string(item.explanation,4000);string(item.concept,200);
    if(ids.has(item.id)||prompts.has(item.prompt.trim().toLowerCase())||!Object.hasOwn(actual,item.type))invalid();
    ids.add(item.id);prompts.add(item.prompt.trim().toLowerCase());actual[item.type]++;
    citations(item.citations,allowed);
    if(!Array.isArray(item.choices)||!Array.isArray(item.rubric))invalid();
    for(const choice of item.choices)string(choice,1000);
    for(const point of item.rubric)string(point,1000);
    if(item.type==='mcq'&&(item.choices.length!==4||new Set(item.choices).size!==4||!Number.isInteger(item.answer)||item.answer<0||item.answer>3))invalid();
    if(item.type==='tf'&&(item.choices.length||typeof item.answer!=='boolean'))invalid();
    if(item.type==='essay'){if(item.choices.length||!item.rubric.length)invalid();string(item.answer,4000);}
  }
  if(Object.keys(actual).some(key=>actual[key]!==counts[key]))invalid();
};
module.exports={preparation,generated};
