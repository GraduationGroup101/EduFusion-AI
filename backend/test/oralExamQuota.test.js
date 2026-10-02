const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createQuota,duration}=require('../src/oralExam/modelQuota');
const body=JSON.stringify({messages:['source'],max_tokens:100});
const headers=(remaining,reset='2s')=>new Headers({'x-ratelimit-limit-tokens':'8000','x-ratelimit-remaining-tokens':String(remaining),'x-ratelimit-reset-tokens':reset});

test('quota durations accept documented compound units and reject unsafe header text',()=>{
  assert.equal(duration('2m59.56s'),179560);assert.equal(duration('7.66s'),7660);assert.equal(duration('500ms'),500);
  for(const value of [null,'garbage','-1s','2s credentials','Infinitys'])assert.equal(duration(value),null);
});
test('token quota exhaustion waits before fetch without changing the exam deadline',async()=>{
  let now=1000,called=0;const waits=[],quota=createQuota({now:()=>now,wait:async ms=>{waits.push(ms);now+=ms;}}),expiresAt=new Date(20000);
  quota.observe('model',headers(10));await quota.run('model',body,{expiresAt},async()=>{called++;assert.equal(now,3250);return new Response('{}');});
  assert.equal(called,1);assert.deepEqual(waits,[2250]);assert.equal(+expiresAt,20000);
});
test('available quota, expired windows and malformed headers do not delay a request',async()=>{
  let now=1000;const quota=createQuota({now:()=>now,wait:async()=>assert.fail('Unexpected quota wait')});
  quota.observe('model',headers(7000));await quota.run('model',body,{},async()=>new Response('{}'));
  quota.observe('model',headers(0));now=4000;await quota.run('model',body,{},async()=>new Response('{}'));
  quota.observe('other',new Headers({'x-ratelimit-remaining-tokens':'not a number'}));await quota.run('other',body,{},async()=>new Response('{}'));
});
test('quota wait cannot exceed the unchanged exam deadline or one minute bound',async()=>{
  const quota=createQuota({now:()=>1000,wait:async()=>assert.fail('Unexpected wait')});quota.observe('model',headers(0));
  let called=false;await assert.rejects(()=>quota.run('model',body,{expiresAt:new Date(2500)},async()=>{called=true;}),{code:'model_quota_deadline'});assert.equal(called,false);
  quota.observe('model',headers(0,'2m'));await assert.rejects(()=>quota.run('model',body,{},async()=>{called=true;}),{code:'model_quota_deadline'});assert.equal(called,false);
});
test('aborting an in-flight owner releases the quota queue and ignores its late response',async()=>{
  const quota=createQuota(),controller=new AbortController();let releaseOld;
  const first=quota.run('model',body,{signal:controller.signal},()=>new Promise(resolve=>{releaseOld=resolve;}));
  await new Promise(resolve=>setImmediate(resolve));controller.abort();await assert.rejects(()=>first,{name:'AbortError'});
  await quota.run('model',body,{},async()=>new Response('{}'));releaseOld(new Response('{}',{headers:headers(0,'2m')}));
  await quota.run('model',body,{},async()=>new Response('{}'));
});
