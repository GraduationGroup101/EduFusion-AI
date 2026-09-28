const assert=require('node:assert/strict');
const {test}=require('node:test');
const {EventEmitter}=require('node:events');
const {transcriber,speak}=require('../src/oralExam/voice');
test('STT streams bounded PCM, maps partial/final speech, and closes on cancellation',async()=>{
  let socket,url,options,partial,final,errors=0;
  class Fake extends EventEmitter {
    constructor(u,o){super();url=u;options=o;socket=this;this.bufferedAmount=0;this.sent=[];}
    send(raw,callback){this.sent.push(JSON.parse(raw));callback();}
    terminate(){this.closed=true;}
  }
  const controller=new AbortController();
  const provider=transcriber({language:'ar',onPartial:t=>{partial=t;},onFinal:t=>{final=t;},onError:()=>{errors++;},signal:controller.signal},{WebSocketImpl:Fake});
  assert.equal(provider.send(Buffer.alloc(3200)),false);
  socket.emit('message',Buffer.from(JSON.stringify({message_type:'session_started'})));await provider.opened;
  assert.match(url,/audio_format=pcm_16000/);assert.match(url,/commit_strategy=vad/);assert.ok(Object.hasOwn(options.headers,'xi-api-key'));
  assert.equal(provider.send(Buffer.alloc(3200)),true);assert.equal(socket.sent[0].sample_rate,16000);
  socket.emit('message',JSON.stringify({message_type:'partial_transcript',text:'الراوتر'}));
  socket.emit('message',JSON.stringify({message_type:'committed_transcript',text:'الراوتر يوجه الحزم'}));
  assert.equal(partial,'الراوتر');assert.equal(final,'الراوتر يوجه الحزم');controller.abort();assert.equal(socket.closed,true);assert.equal(errors,0);
});
test('STT failure is fixed-message and never exposes a provider error payload',async()=>{
  let socket,errors=0;
  class Fake extends EventEmitter {constructor(){super();socket=this;this.bufferedAmount=0;}terminate(){}}
  const provider=transcriber({language:'en',onPartial(){},onFinal(){},onError(){errors++;},signal:new AbortController().signal},{WebSocketImpl:Fake});
  socket.emit('message',JSON.stringify({message_type:'auth_error',error:'sensitive provider diagnostics'}));
  await assert.rejects(provider.opened,/Speech service unavailable/);assert.equal(errors,1);
});
test('TTS validates content type and audio signature before returning playback',async()=>{
  const signal=new AbortController().signal;
  await assert.rejects(()=>speak('Question','en',signal,async()=>new Response('{"error":"private"}',{headers:{'content-type':'application/json'}})),/Speech playback unavailable/);
  await assert.rejects(()=>speak('Question','en',signal,async()=>new Response('not mp3',{headers:{'content-type':'audio/mpeg'}})),/Invalid speech audio/);
  const audio=await speak('Question','en',signal,async()=>new Response(Buffer.from('ID3test'),{headers:{'content-type':'audio/mpeg'}}));
  assert.equal(audio.toString(),'ID3test');
});
