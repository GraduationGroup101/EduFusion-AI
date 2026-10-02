const assert=require('node:assert/strict');
const {test,after}=require('node:test');
const z=require('zod');
const contracts=require('../src/oralExam/contracts');
const examiner=require('../src/oralExam/examiner');
const originalFetch=global.fetch;
const originalError=console.error;
process.env.GROQ_API_KEY='test-only';
process.env.ORAL_EXAM_MODEL='openai/gpt-oss-120b';
after(()=>{global.fetch=originalFetch;console.error=originalError;});
const question={question:'What does a router do?',concept:'Routing',question_type:'initial',difficulty:'foundation',citations:['text-1'],follow_up_reason:''};
const decision={transition:null,core_concepts:null,intent:'answer',reply:null,assessment:null,next:question};
const report={understanding:80,accuracy:80,completeness:75,communication:90,strengths:['Path selection'],areasForImprovement:['Add detail'],topicsCovered:['Routing'],summary:'You explained the core idea.'};
const session=()=>({language:'en',expires_at:new Date(Date.now()+600000),server_now:new Date(),turns:[],context:{chunks:[{id:'text-1',section:'Network',text:'Routers select paths for packets.'}]}});
const reply=value=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));
function mock(values) {let calls=0;global.fetch=async(_url,options)=>{const payload=JSON.parse(options.body);assert.equal(payload.model,'openai/gpt-oss-120b');assert.equal(payload.response_format.type,'json_schema');assert.equal(payload.response_format.json_schema.strict,true);return values[Math.min(calls++,values.length-1)].clone()};return ()=>calls;}
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
test('provider 5xx retries, while authorization failures do not',async()=>{
  let calls=mock([new Response('{}',{status:503}),reply(decision)]);
  assert.deepEqual(await examiner.next(session(),null),decision);assert.equal(calls(),2);
  calls=mock([new Response(JSON.stringify({error:{code:'invalid_api_key'}}),{status:401})]);
  await assert.rejects(()=>examiner.next(session(),null),{name:'ProviderError',status:401});assert.equal(calls(),1);
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

test('provider JSON validation rejection retries once and rate limiting honors Retry-After',async()=>{
  let calls=mock([new Response(JSON.stringify({error:{code:'json_validate_failed'}}),{status:400}),reply(decision)]);
  assert.deepEqual(await examiner.next(session(),null),decision);assert.equal(calls(),2);
  calls=mock([new Response(JSON.stringify({error:{code:'rate_limit_exceeded'}}),{status:429,headers:{'retry-after':'1'}}),reply(decision)]);
  const start=Date.now();await examiner.next(session(),null);assert.ok(Date.now()-start>=950);assert.equal(calls(),2);
  calls=mock([new Response('{}',{status:429,headers:{'retry-after':'120'}})]);
  await assert.rejects(()=>examiner.next(session(),null),{status:429});assert.equal(calls(),1);
});

test('GPT-OSS reserves JSON headroom and uses supported low reasoning without relaxing the assessment contract',async()=>{
 const s=session(),deadline=s.expires_at;let body;global.fetch=async(_url,o)=>{body=JSON.parse(o.body);return reply(decision);};
 assert.deepEqual(await examiner.next(s,null),decision);assert.equal(body.max_tokens,4096);assert.equal(body.reasoning_effort,'low');assert.equal(body.response_format.json_schema.strict,true);assert.deepEqual(body.response_format.json_schema.schema,contracts.decisionJsonSchema);assert.equal(s.expires_at,deadline);
});
test('models without GPT-OSS reasoning retain their existing budget and receive no unsupported effort option',async()=>{
 const prior=process.env.ORAL_EXAM_MODEL;process.env.ORAL_EXAM_MODEL='llama-3.3-70b-versatile';let body;
 try{global.fetch=async(_url,o)=>{body=JSON.parse(o.body);return reply(decision);};assert.deepEqual(await examiner.next(session(),null),decision);assert.equal(body.max_tokens,1800);assert.ok(!Object.hasOwn(body,'reasoning_effort'));assert.equal(body.response_format.json_schema.strict,true);}
 finally{process.env.ORAL_EXAM_MODEL=prior;}
});

test('actual 9883-token initialization rejection resizes once to fit an 8000-token bucket without changing sources or schema',async()=>{
 const s=session(),deadline=s.expires_at,bodies=[];
 global.fetch=async(_url,o)=>{const b=JSON.parse(o.body);bodies.push(b);return bodies.length===1?new Response(JSON.stringify({error:{code:'rate_limit_exceeded',message:'Limit 8000, Requested 9883'}}),{status:413,headers:{'x-ratelimit-limit-tokens':'8000'}}):reply(decision);};
 assert.deepEqual(await examiner.next(s,null),decision);assert.equal(bodies.length,2);assert.equal(bodies[0].max_tokens,4096);assert.equal(bodies[1].max_tokens,1920);
 assert.ok(9883-4096+bodies[1].max_tokens<8000);assert.deepEqual(bodies[1].messages,bodies[0].messages);assert.deepEqual(bodies[1].response_format,bodies[0].response_format);assert.equal(bodies[1].reasoning_effort,'low');assert.equal(s.expires_at,deadline);
});
test('413 with insufficient JSON headroom or unknown size is never blindly retried',async()=>{
 for(const message of ['Limit 8000, Requested 12000','untrusted payload']){
  const calls=mock([new Response(JSON.stringify({error:{code:'rate_limit_exceeded',message}}),{status:413,headers:{'x-ratelimit-limit-tokens':'8000'}})]);
  await assert.rejects(()=>examiner.next(session(),null),{status:413});assert.equal(calls(),1);
 }
});
