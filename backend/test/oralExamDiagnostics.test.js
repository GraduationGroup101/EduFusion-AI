const assert=require('node:assert/strict');
const {test}=require('node:test');
const {lifecycle}=require('../src/oralExam/diagnostics');
test('lifecycle diagnostics include safe connection metadata and reject payloads and capabilities',()=>{
  const info=console.info,records=[];
  console.info=message=>records.push(JSON.parse(message));
  try {
    lifecycle('disconnect',{session:'fixture-session',connection:'fixture-connection',code:1006,reason:'transport_lost',
      token:'private-auth',lease_token:'private-write-lease',connectionKey:'private-browser-key',audio:'private-audio',transcript:'private-speech'});
    assert.equal(records[0].event,'oral_exam.disconnect');assert.equal(records[0].code,1006);
    assert.equal(records[0].session,'fixture-session');assert.ok(records[0].at);
    assert.doesNotMatch(JSON.stringify(records),/private/);
  } finally {console.info=info;}
});
