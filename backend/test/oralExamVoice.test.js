const {test}=require('node:test');
const assert=require('node:assert/strict');
const {speak,diagnostic}=require('../src/oralExam/voice');
test('speech failures retain only bounded status and known provider codes',async()=>{
  for(const [status,code] of [[429,'rate_limit_exceeded'],[401,'quota_exceeded'],[503,'private-secret-answer']]){
    await assert.rejects(()=>speak('Fixture','en',new AbortController().signal,async()=>new Response(JSON.stringify({detail:{status:code,message:'private-answer'}}),{status})),error=>{
      const result=diagnostic(error);assert.equal(result.provider_status,status);assert.equal(result.provider,'elevenlabs');assert.equal(result.provider_code,code==='private-secret-answer'?undefined:code);assert.doesNotMatch(JSON.stringify(result),/private/);return true;
    });
  }
});
test('speech diagnostics distinguish invalid content type, audio and timeout',async()=>{
  for(const [body,type,code] of [['data','application/json','invalid_content_type'],['not mp3','audio/mpeg','invalid_audio']]){
    await assert.rejects(()=>speak('Fixture','en',new AbortController().signal,async()=>new Response(body,{headers:{'content-type':type}})),e=>diagnostic(e).provider_code===code);
  }
  assert.equal(diagnostic(new DOMException('private','TimeoutError')).error_class,'TimeoutError');
});
