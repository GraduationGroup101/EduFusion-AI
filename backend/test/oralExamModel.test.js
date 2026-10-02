const assert=require('node:assert/strict');
const {test,after}=require('node:test');
const z=require('zod');
const contracts=require('../src/oralExam/contracts');
const examiner=require('../src/oralExam/examiner');
const modelProvider=require('../src/oralExam/modelProvider');
const originalFetch=global.fetch;
const originalError=console.error;
process.env.ORAL_EXAM_API_KEY='test-only';
delete process.env.GROQ_API_KEY;
delete process.env.ORAL_EXAM_API_BASE_URL;
delete process.env.ORAL_EXAM_MODEL;
after(()=>{global.fetch=originalFetch;console.error=originalError;});
const OPENROUTER='https://openrouter.ai/api/v1/chat/completions';
const question={question:'What does a router do?',concept:'Routing',question_type:'initial',difficulty:'foundation',citations:['text-1'],follow_up_reason:''};
const decision={transition:null,core_concepts:null,intent:'answer',reply:null,assessment:null,next:question};
const report={understanding:80,accuracy:80,completeness:75,communication:90,strengths:['Path selection'],areasForImprovement:['Add detail'],topicsCovered:['Routing'],summary:'You explained the core idea.'};
const session=()=>({language:'en',expires_at:new Date(Date.now()+600000),server_now:new Date(),turns:[],context:{chunks:[{id:'text-1',section:'Network',text:'Routers select paths for packets.'}]}});
const reply=value=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));
function mock(values) {let calls=0;global.fetch=async(url,options)=>{
  assert.equal(url,OPENROUTER);assert.doesNotMatch(String(url),/groq/i);
  assert.equal(options.headers.Authorization,`Bearer ${process.env.ORAL_EXAM_API_KEY}`);
  const payload=JSON.parse(options.body);assert.equal(payload.model,'openai/gpt-oss-120b');assert.equal(payload.provider.require_parameters,true);
  assert.equal(payload.response_format.type,'json_schema');assert.equal(payload.response_format.json_schema.strict,true);return values[Math.min(calls++,values.length-1)].clone()};return ()=>calls;}
// OpenRouter reports an upstream provider rejection as its own status with the
// provider's untrusted body in error.metadata.raw.
const relayed=(status,raw,code=status)=>new Response(JSON.stringify({error:{code,message:'Provider returned error',metadata:{provider_name:'Fixture',raw:JSON.stringify(raw)}}}),{status});
test('provider schemas derive exactly from Zod and close all nested objects',()=>{
  for(const [contract,schema] of [[contracts.decision,contracts.decisionJsonSchema],[contracts.evaluation,contracts.evaluationJsonSchema]]) {
    const generated=z.toJSONSchema(contract);delete generated.$schema;
    assert.deepEqual(schema,generated);
    const visit=node=>{if(!node||typeof node!=='object')return;if(node.type==='object'){assert.equal(node.additionalProperties,false);assert.deepEqual(node.required,Object.keys(node.properties));}for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else visit(value);};
    visit(schema);
  }
  assert.deepEqual(contracts.decisionJsonSchema.properties.assessment.anyOf[0].properties.understanding,{type:'integer',minimum:0,maximum:100});
});
test('valid structured decision and evaluation pass, malformed shapes fail Zod',async()=>{
  let calls=mock([reply(decision)]);
  assert.deepEqual(await examiner.next(session(),null),decision);assert.equal(calls(),1);
  calls=mock([reply(report)]);
  assert.deepEqual(await examiner.jsonModel([],{operation:'final_evaluation',schemaName:'oral_exam_evaluation',schema:contracts.evaluationJsonSchema,contract:contracts.evaluation}),report);
  assert.equal(calls(),1);
  for(const invalid of [
    {...decision,next:{...question,question:42}},
    {...decision,next:{...question,concept:undefined}},
    {...decision,next:{...question,extra:'unexpected'}},
    {assessment:{understanding:80.5,accuracy:80,completeness:75,communication:90,feedback:'Okay',strengths:[],improvements:[]},next:question},
    {...decision,next:{...question,difficulty:'impossible'}},
  ])assert.equal(contracts.decision.safeParse(invalid).success,false);
  for(const invalid of [{...report,accuracy:'80'},{...report,summary:undefined},{...report,extra:true},{...report,accuracy:80.5}])assert.equal(contracts.evaluation.safeParse(invalid).success,false);
});
test('one invalid output retries once and succeeds without changing session deadline',async()=>{
  const current=session(),started=current.expires_at;
  const calls=mock([reply({...decision,next:{...question,difficulty:'invalid'}}),reply(decision)]);
  assert.deepEqual(await examiner.next(current,null),decision);
  assert.equal(calls(),2);assert.equal(current.expires_at,started);
});
test('provider 5xx retries boundedly, while authorization failures do not retry',async()=>{
  let calls=mock([new Response('{}',{status:503}),reply(decision)]);
  assert.deepEqual(await examiner.next(session(),null),decision);assert.equal(calls(),2);
  calls=mock([new Response('{}',{status:502})]);
  await assert.rejects(()=>examiner.next(session(),null),{name:'ProviderError',status:502});assert.equal(calls(),2);
  for(const status of [401,403]) {
    calls=mock([new Response(JSON.stringify({error:{code:status,message:'No auth credentials found'}}),{status})]);
    await assert.rejects(()=>examiner.next(session(),null),error=>{
      assert.equal(error.name,'ProviderError');assert.equal(error.status,status);
      // The student-facing reason never carries the provider's own wording.
      assert.equal(examiner.failureCode(error),'model_auth');
      assert.equal(error.message,'Exam model unavailable');
      assert.doesNotMatch(JSON.stringify(examiner.diagnostic('next_question',error,1)),/credentials/i);
      return true;
    });
    assert.equal(calls(),1);
  }
});
test('all attempts fail validation and aborted or expired exams never retry',async()=>{
  let calls=mock([reply({...decision,next:{...question,question_type:'bad'}})]);
  await assert.rejects(()=>examiner.next(session(),null),{name:'ZodError'});assert.equal(calls(),2);
  const controller=new AbortController();
  let abortedCalls=0;
  global.fetch=async()=>{abortedCalls++;controller.abort();return reply({...decision,next:{...question,question_type:'bad'}});};
  await assert.rejects(()=>examiner.next(session(),null,controller.signal),{name:'ZodError'});assert.equal(abortedCalls,1);
  let requested=false;global.fetch=async()=>{requested=true;return reply(decision);};
  await assert.rejects(()=>examiner.next({...session(),expires_at:new Date(Date.now()-1)},null),{name:'AbortError'});
  assert.equal(requested,false);
  const expiring=session();expiring.expires_at=new Date(Date.now()+20);
  let timeoutCalls=0;
  global.fetch=async()=>{timeoutCalls++;await new Promise(resolve=>setTimeout(resolve,35));return reply({...decision,next:{...question,question_type:'bad'}});};
  await assert.rejects(()=>examiner.next(expiring,null),{name:'ZodError'});
  assert.equal(timeoutCalls,1);
});

test('provider JSON validation rejection retries once, directly and when relayed by OpenRouter',async()=>{
  let calls=mock([new Response(JSON.stringify({error:{code:'json_validate_failed'}}),{status:400}),reply(decision)]);
  assert.deepEqual(await examiner.next(session(),null),decision);assert.equal(calls(),2);
  calls=mock([relayed(400,{error:{code:'json_validate_failed',message:'schema rejected'}}),reply(decision)]);
  assert.deepEqual(await examiner.next(session(),null),decision);assert.equal(calls(),2);
  calls=mock([relayed(400,{error:{code:'json_validate_failed'}})]);
  await assert.rejects(()=>examiner.next(session(),null),error=>{
    assert.equal(error.code,'json_validate_failed');assert.equal(examiner.failureCode(error),'invalid_model_output');return true;
  });
  assert.equal(calls(),2);
});
test('rate limiting honors Retry-After, stays bounded and never extends the exam deadline',async()=>{
  let calls=mock([new Response(JSON.stringify({error:{code:429,message:'Rate limit exceeded'}}),{status:429,headers:{'retry-after':'1','x-ratelimit-remaining':'0','x-ratelimit-limit':'200'}}),reply(decision)]);
  const current=session(),deadline=current.expires_at,start=Date.now();
  assert.deepEqual(await examiner.next(current,null),decision);
  assert.ok(Date.now()-start>=950);assert.equal(calls(),2);assert.equal(current.expires_at,deadline);
  // A wait longer than the bound is refused instead of queued.
  calls=mock([new Response('{}',{status:429,headers:{'retry-after':'120'}})]);
  await assert.rejects(()=>examiner.next(session(),null),{status:429});assert.equal(calls(),1);
  // A missing Retry-After still waits a bounded default rather than retrying immediately.
  calls=mock([new Response('{}',{status:429})]);
  const short=session();short.expires_at=new Date(Date.now()+5000);
  await assert.rejects(()=>examiner.next(short,null),{status:429});assert.equal(calls(),1);
  // Only numeric quota metadata reaches diagnostics.
  const metadata=mock([new Response(JSON.stringify({error:{code:429,metadata:{provider_name:'Fixture'}}}),{status:429,headers:{'retry-after':'120','x-ratelimit-limit':'200','x-ratelimit-remaining':'0'}})]);
  await assert.rejects(()=>examiner.next(session(),null),error=>{
    assert.deepEqual(error.rateLimits,{limit:200,remaining:0});
    assert.equal(examiner.diagnostic('next_question',error,1).provider,'openrouter');
    assert.doesNotMatch(JSON.stringify(examiner.diagnostic('next_question',error,1)),/Fixture/);
    assert.equal(examiner.failureCode(error),'model_unavailable');return true;
  });
  assert.equal(metadata(),1);
});
test('a 429 retry that would outlast the exam deadline is refused instead of waiting',async()=>{
  const expiring=session();expiring.expires_at=new Date(Date.now()+1200);
  const calls=mock([new Response('{}',{status:429,headers:{'retry-after':'2'}})]);
  const deadline=expiring.expires_at;
  await assert.rejects(()=>examiner.next(expiring,null),{status:429});
  assert.equal(calls(),1);assert.equal(expiring.expires_at,deadline);
});

test('GPT-OSS reserves JSON headroom and uses supported low reasoning without relaxing the assessment contract',async()=>{
 const s=session(),deadline=s.expires_at;let body;global.fetch=async(_url,o)=>{body=JSON.parse(o.body);return reply(decision);};
 assert.deepEqual(await examiner.next(s,null),decision);assert.equal(body.max_tokens,4096);assert.equal(body.temperature,0.2);assert.deepEqual(body.reasoning,{effort:'low'});assert.equal(body.response_format.json_schema.strict,true);assert.deepEqual(body.response_format.json_schema.schema,contracts.decisionJsonSchema);assert.equal(s.expires_at,deadline);
});
test('models without GPT-OSS reasoning retain their existing budget and receive no unsupported effort option',async()=>{
 const prior=process.env.ORAL_EXAM_MODEL;process.env.ORAL_EXAM_MODEL='llama-3.3-70b-versatile';let body;
 try{global.fetch=async(_url,o)=>{body=JSON.parse(o.body);return reply(decision);};assert.deepEqual(await examiner.next(session(),null),decision);assert.equal(body.max_tokens,1800);assert.ok(!Object.hasOwn(body,'reasoning'));assert.equal(body.response_format.json_schema.strict,true);}
 finally{if(prior===undefined)delete process.env.ORAL_EXAM_MODEL;else process.env.ORAL_EXAM_MODEL=prior;}
});

test('an input too large for the provider is never retried with an ineffective smaller output budget',async()=>{
 for(const body of [{error:{code:413,message:'Request too large'}},{error:{code:'context_length_exceeded'}},{}]){
  let calls=0;global.fetch=async()=>{calls++;return new Response(JSON.stringify(body),{status:413,headers:{'x-ratelimit-limit':'200'}});};
  await assert.rejects(()=>examiner.next(session(),null),{status:413});assert.equal(calls,1);
 }
});

test('large grounded initialization omits duplicated source text and passes the request size gate with all criteria intact',async()=>{
 const grounding=require('../src/oralExam/grounding');const points=['Routing: A router connects different IP networks and forwards packets using a routing table that maps destination prefixes to a next hop.','Switching: A switch connects devices in the same local network, learns source MAC addresses and forwards frames to a known destination port.','DHCP: DHCP supplies an IP address, subnet mask, gateway and DNS server using Discover, Offer, Request and Acknowledge.','DNS: DNS translates domain names into IP addresses and uses cached records whose freshness is controlled by time to live.','Transport: TCP provides a reliable ordered byte stream using sequence numbers, acknowledgements and retransmission.'];
 const chunks=Array.from({length:12},(_,i)=>({id:'text-'+(i+1),section:'Material',text:Array(Math.ceil(1500/points[i%5].length)).fill(points[i%5]).join(' ')}));
 const s={...session(),context:{chunks,grounding_version:1,oral_policy:{version:1,required_concepts:5,max_follow_ups:2,max_bonus:5}}};const evidence=examiner.evidenceFor(s,null),criteria=grounding.catalog(evidence);const plan=points.map(point=>{const name=point.split(':')[0],chunk=evidence.find(c=>c.text.startsWith(name+':'));return {name,citations:[chunk.id]};});const first=plan[0],criterion=criteria.find(c=>c.citations.includes(first.citations[0]));let calls=0;
 global.fetch=async(_url,o)=>{calls++;const b=JSON.parse(o.body),payload=JSON.parse(b.messages[1].content);assert.deepEqual(payload.source_criteria,JSON.parse(JSON.stringify(grounding.promptCatalog(criteria))));assert.match(b.messages[0].content,/citations arrays MUST use chunk keys/);assert.match(b.messages[0].content,/source-supported concepts/);assert.equal(b.max_tokens,4096);assert.equal(b.response_format.json_schema.strict,true);const duplicate=JSON.stringify({...b,messages:[b.messages[0],{...b.messages[1],content:JSON.stringify({...payload,question_generation_evidence:evidence})}]});assert.ok(Buffer.byteLength(duplicate)>35000);assert.ok(Buffer.byteLength(o.body)<35000);
 return reply({...decision,core_concepts:plan,next:{...question,question:'Explain how a router forwards packets.',concept:first.name,citations:first.citations,criterion_ids:[criterion.id]}});};
 const result=await examiner.next(s,null);assert.equal(calls,1);assert.equal(result.core_concepts.length,5);assert.deepEqual(result.next.grading_criteria,[criterion]);
});

test('provider JSON rejection logs only missing known contract fields without exposing failed output',async()=>{
 const generation=JSON.stringify({intent:'answer',reply:null,assessment:null,next:null,transition:'private-student-content'});
 for(const body of [{error:{code:'json_validate_failed',failed_generation:generation}},
   {error:{code:400,message:'Provider returned error',metadata:{provider_name:'Fixture',raw:JSON.stringify({error:{code:'json_validate_failed',failed_generation:generation}})}}}]){
  global.fetch=async()=>new Response(JSON.stringify(body),{status:400});
  await assert.rejects(()=>examiner.jsonModel([],{operation:'fixture',schemaName:'fixture',schema:contracts.decisionJsonSchema,contract:contracts.decision,maxAttempts:1}),e=>{const d=examiner.diagnostic('fixture',e,1);assert.deepEqual(d.missing_required_fields,['core_concepts']);assert.doesNotMatch(JSON.stringify(d),/private-student-content/);assert.doesNotMatch(JSON.stringify(d),/Provider returned error/);return true;});
 }
});


test('new exams accept reviewed Arabic translations while rejecting unsupported question meaning',async()=>{
 const g=require('../src/oralExam/grounding');
 const s={...session(),language:'ar',context:{...session().context,grounding_version:2,oral_policy:{version:1,required_concepts:1,max_follow_ups:2,max_bonus:5}}};
 const criterion=g.catalog(s.context.chunks)[0];
 const translated={...decision,core_concepts:[{name:'توجيه البيانات',citations:['text-1']}],next:{...question,question:'كيف يختار الموجّه مسار الحزم؟',concept:'توجيه البيانات',criterion_ids:[criterion.id]}};
 let review=true,calls=0;
 global.fetch=async(_url,o)=>{calls++;const b=JSON.parse(o.body);if(b.response_format.json_schema.name==='oral_exam_decision'&&JSON.parse(b.messages[1].content).language==='ar'&&review)assert.match(b.messages[0].content,/natural Arabic wording/);return reply(b.response_format.json_schema.name==='source_support'?{supported:review}:translated);};
 const result=await examiner.next(s,null);assert.equal(result.next.question,translated.next.question);assert.deepEqual(result.next.grading_criteria,[criterion]);assert.equal(calls,2);
 review=false;await assert.rejects(()=>examiner.next(s,null),e=>e.code==='unsupported_question_meaning');
 // Historical exams retain their old validation; no saved report is reinterpreted.
 await assert.rejects(()=>examiner.next({...s,context:{...s.context,grounding_version:1}},null),e=>e.code==='unsupported_question_term');
});

test('the default provider is OpenRouter with the unchanged model and no Groq key',async()=>{
 assert.equal(modelProvider.oralExam.defaultBaseUrl,'https://openrouter.ai/api/v1');
 assert.equal(modelProvider.oralExam.defaultModel,'openai/gpt-oss-120b');
 assert.equal(modelProvider.oralExam.endpoint({}),OPENROUTER);
 assert.equal(modelProvider.oralExam.model({}),'openai/gpt-oss-120b');
 let url,options;global.fetch=async(target,value)=>{url=target;options=value;return reply(decision);};
 process.env.GROQ_API_KEY='groq-must-not-be-used';
 try {
  assert.deepEqual(await examiner.next(session(),null),decision);
  assert.equal(url,OPENROUTER);
  assert.equal(options.headers.Authorization,'Bearer test-only');
  assert.doesNotMatch(JSON.stringify(options.headers),/groq-must-not-be-used/);
  assert.equal(JSON.parse(options.body).model,'openai/gpt-oss-120b');
 } finally {delete process.env.GROQ_API_KEY;}
});

test('ORAL_EXAM_API_BASE_URL overrides the endpoint and an unusable value falls back to OpenRouter',async()=>{
 for(const [configured,expected] of [['https://gateway.example.com/v1','https://gateway.example.com/v1/chat/completions'],
   ['https://gateway.example.com/v1/','https://gateway.example.com/v1/chat/completions'],
   ['ftp://gateway.example.com',OPENROUTER],['not a url',OPENROUTER],['',OPENROUTER]])
  assert.equal(modelProvider.oralExam.endpoint({ORAL_EXAM_API_BASE_URL:configured}),expected);
 const prior=process.env.ORAL_EXAM_API_BASE_URL;process.env.ORAL_EXAM_API_BASE_URL='https://gateway.example.com/v1';
 let url;
 try {
  global.fetch=async(target)=>{url=target;return reply(decision);};
  assert.deepEqual(await examiner.next(session(),null),decision);
  assert.equal(url,'https://gateway.example.com/v1/chat/completions');
 } finally {if(prior===undefined)delete process.env.ORAL_EXAM_API_BASE_URL;else process.env.ORAL_EXAM_API_BASE_URL=prior;}
});

test('optional OpenRouter attribution headers are configurable, validated and never required',()=>{
 const headers=env=>modelProvider.oralExam.headers({ORAL_EXAM_API_KEY:'k',...env});
 assert.deepEqual(headers({}),{Authorization:'Bearer k','Content-Type':'application/json','X-Title':'EduFusion Oral Exam'});
 assert.equal(headers({ORAL_EXAM_APP_URL:'https://edufusion.example.com'})['HTTP-Referer'],'https://edufusion.example.com');
 assert.equal(headers({ORAL_EXAM_APP_TITLE:'EduFusion'})['X-Title'],'EduFusion');
 for(const site of ['javascript:alert(1)','not a url','https://host/<script>'])
  assert.ok(!Object.hasOwn(headers({ORAL_EXAM_APP_URL:site}),'HTTP-Referer'),site);
 assert.ok(!Object.hasOwn(headers({ORAL_EXAM_APP_TITLE:'bad\ntitle'}),'X-Title'));
});

test('the separate lecture-tools and academic-assistant provider keeps its own Groq connection',async()=>{
 const {groq}=modelProvider;
 assert.equal(groq.endpoint({}),'https://api.groq.com/openai/v1/chat/completions');
 assert.equal(groq.model({}),'openai/gpt-oss-120b');
 assert.equal(groq.model({GROQ_MODEL:'llama-3.3-70b-versatile'}),'llama-3.3-70b-versatile');
 // Its key is never read from the Oral Exam variable, and it carries no
 // OpenRouter routing or attribution headers.
 assert.deepEqual(groq.headers({GROQ_API_KEY:'g',ORAL_EXAM_API_KEY:'o',ORAL_EXAM_APP_URL:'https://edufusion.example.com'}),
  {Authorization:'Bearer g','Content-Type':'application/json'});
 assert.equal(groq.routing(),undefined);
 // An Oral Exam base URL override cannot redirect it.
 assert.equal(groq.endpoint({ORAL_EXAM_API_BASE_URL:'https://gateway.example.com/v1'}),'https://api.groq.com/openai/v1/chat/completions');
 // The shared transport honours the requesting service's provider.
 let url,options;global.fetch=async(target,value)=>{url=target;options=value;return reply({supported:true});};
 const wording=z.object({supported:z.boolean()}).strict();
 await examiner.jsonModel([],{operation:'fixture',schemaName:'fixture',schema:contracts.providerSchema(wording),contract:wording,provider:groq});
 assert.equal(url,'https://api.groq.com/openai/v1/chat/completions');
 assert.ok(!Object.hasOwn(JSON.parse(options.body),'provider'));
 assert.deepEqual(JSON.parse(options.body).reasoning_effort,'low');
});

test('an OpenRouter success envelope parses while malformed model output fails safely',async()=>{
 global.fetch=async()=>new Response(JSON.stringify({id:'gen-fixture',provider:'Fixture',model:'openai/gpt-oss-120b',object:'chat.completion',
   choices:[{index:0,finish_reason:'stop',native_finish_reason:'stop',message:{role:'assistant',content:JSON.stringify(decision),reasoning:'ignored',refusal:null}}],
   usage:{prompt_tokens:10,completion_tokens:20,total_tokens:30}}));
 assert.deepEqual(await examiner.next(session(),null),decision);
 for(const body of [{choices:[{message:{content:'not json'}}]},{choices:[]},{choices:[{message:{}}]},{}]){
  global.fetch=async()=>new Response(JSON.stringify(body));
  await assert.rejects(()=>examiner.next(session(),null),error=>{
   assert.ok(['SyntaxError','ZodError'].includes(error.name),error.name);
   assert.equal(examiner.failureCode(error),'invalid_model_output');return true;
  });
 }
 // An oversized body is rejected before it is parsed.
 global.fetch=async()=>new Response(JSON.stringify({choices:[{message:{content:'x'.repeat(70000)}}]}));
 await assert.rejects(()=>examiner.next(session(),null),{name:'ModelValidationError',code:'response_too_large'});
});

test('transport failures and timeouts stay distinguishable from provider rejections',async()=>{
 global.fetch=async()=>{throw new TypeError('fetch failed');};
 await assert.rejects(()=>examiner.next(session(),null),error=>{assert.equal(examiner.failureCode(error),'network');return true;});
 global.fetch=async()=>{throw Object.assign(new Error('timed out'),{name:'TimeoutError'});};
 await assert.rejects(()=>examiner.next(session(),null),error=>{assert.equal(examiner.failureCode(error),'timeout');return true;});
});

test('no Oral Exam runtime module calls the Groq API or reads its key',()=>{
 const fs=require('node:fs'),path=require('node:path'),root=path.join(__dirname,'..','src');
 const files=[path.join(root,'routes','oralExam.js')];
 const walk=dir=>{for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const full=path.join(dir,entry.name);
  if(entry.isDirectory())walk(full);else if(entry.name.endsWith('.js'))files.push(full);
 }};
 walk(path.join(root,'oralExam'));
 // modelProvider.js is the shared registry: it still describes the Groq
 // connection the lecture tools and the academic assistant use. The Oral Exam
 // descriptor assertions below prove the exam itself cannot reach it.
 const registry=path.join(root,'oralExam','modelProvider.js');
 for(const file of files.filter(entry=>entry!==registry)){
  const source=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(source,/api\.groq\.com/,file);
  assert.doesNotMatch(source,/GROQ_API_KEY/,file);
 }
 for(const env of [{},{GROQ_API_KEY:'g'},{GROQ_API_KEY:'g',GROQ_MODEL:'llama-3.3-70b-versatile'},{ORAL_EXAM_API_KEY:'o',GROQ_API_KEY:'g'}]){
  assert.doesNotMatch(modelProvider.oralExam.endpoint(env),/groq/i);
  assert.doesNotMatch(JSON.stringify(modelProvider.oralExam.headers(env)),/\bg\b/);
  assert.equal(modelProvider.oralExam.model(env),'openai/gpt-oss-120b');
 }
});
