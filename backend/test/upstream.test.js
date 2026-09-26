const assert=require('node:assert/strict');
const {test}=require('node:test');
const {requestUpstream}=require('../src/lib/upstream');
test('a deadline also cancels a stalled response body',async()=>{
  const original=global.fetch;
  global.fetch=async(url,{signal})=>new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(Object.assign(new Error('aborted'),{name:'AbortError'})));}}));
  try{await assert.rejects(requestUpstream(null,'https://provider.test',{},{timeoutMs:30}),{name:'AbortError'});}
  finally{global.fetch=original;}
});
test('POST requests are never retried automatically',async()=>{
  const original=global.fetch;let calls=0;
  global.fetch=async()=>{calls++;return new Response('{}',{status:503});};
  try{assert.equal((await requestUpstream(null,'https://provider.test',{method:'POST'},{retries:3})).status,503);assert.equal(calls,1);}
  finally{global.fetch=original;}
});
