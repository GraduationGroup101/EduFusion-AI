const assert=require('node:assert/strict');
const {test,after}=require('node:test');
const conversation=require('../src/oralExam/conversation');
const contracts=require('../src/oralExam/contracts');
const examiner=require('../src/oralExam/examiner');
const originalFetch=global.fetch;
const originalError=console.error;
process.env.GROQ_API_KEY='test-only';
after(()=>{global.fetch=originalFetch;console.error=originalError;});
console.error=()=>{};

test('obvious English and Arabic control phrases are recognised without a model',()=>{
  const cases={
    repeat:['Repeat the question.','Can you repeat the question?','Say that again','Sorry, I couldn\'t hear you','one more time please','عيد السؤال','ممكن تعيد السؤال؟','أعد السؤال من فضلك','كرر السؤال','مرة ثانية','ما سمعت السؤال'],
    clarify:['I didn\'t understand the question.','I don\'t understand.','What do you mean?','Can you explain what you\'re asking?','Could you rephrase that?','That is not clear','مش فاهم','ما فهمت السؤال','وضح السؤال','ممكن توضح السؤال','يعني ايه؟','شو قصدك بالسؤال؟','مو واضح'],
    dont_know:['I don\'t know.','I don\'t know the answer to that question','No idea','I\'m not sure','I forgot','Skip this one','ما بعرف','مابعرف','لا أعرف','مش عارف','ما أدري','نسيت','معرفش'],
    unclear:['','um','uh huh','...','اممم','اه'],
  };
  for(const [intent,phrases] of Object.entries(cases))for(const phrase of phrases)assert.equal(conversation.classify(phrase),intent,phrase);
});
test('answer attempts are never mistaken for control phrases',()=>{
  const answers=[
    'A router selects a path for packets across networks.',
    'Routers don\'t know the full path, they only choose the next hop based on the routing table.',
    'I think the router forwards packets, I am not sure about the table part but it uses addresses to decide.',
    'The question is about routing: routers repeat the lookup for every packet using destination addresses.',
    'الراوتر يختار المسار للحزم بين الشبكات باستخدام جدول التوجيه',
    'ما بعرف بالضبط لكن الراوتر يوجه الحزم حسب العنوان ويختار أفضل مسار للوصول إلى الشبكة الأخرى بسرعة',
    'no, the switch works at layer two and the router at layer three',
  ];
  for(const answer of answers)assert.equal(conversation.classify(answer),null,answer);
});
test('limits bound repeats and clarifications per question, then nudge once, then treat speech as the answer',()=>{
  const ex=(...kinds)=>kinds.map(kind=>({kind}));
  assert.equal(conversation.resolve('repeat',[]),'repeat');
  assert.equal(conversation.resolve('repeat',ex('repeat')),'repeat');
  assert.equal(conversation.resolve('repeat',ex('repeat','repeat')),'dont_know');
  assert.equal(conversation.resolve('repeat',ex('repeat','repeat','nudge')),'answer');
  assert.equal(conversation.resolve('clarify',ex('clarification')),'dont_know');
  assert.equal(conversation.resolve('clarify',ex('clarification','nudge')),'answer');
  assert.equal(conversation.resolve('dont_know',ex('nudge')),'answer');
  assert.equal(conversation.resolve('unclear',ex('retry','retry')),'dont_know');
  assert.equal(conversation.resolve('repeat',ex('repeat','clarification','retry','retry')),'answer');
  assert.equal(conversation.resolve('answer',[]),'answer');
  assert.equal(conversation.resolve(null,[]),'answer');
  assert.equal(conversation.resolve('bogus',[]),'answer');
});
test('spoken replies exist in both languages and a repeat re-reads the question',()=>{
  assert.match(conversation.reply('repeat','ar','ما هو الراوتر؟'),/إليك السؤال/);
  assert.equal(conversation.spoken('repeat','Of course. Here is the question again.','What does a router do?'),'Of course. Here is the question again. What does a router do?');
  assert.equal(conversation.spoken('clarification','In other words, what is its job?','What does a router do?'),'In other words, what is its job?');
  assert.match(conversation.reply('clarify','en','What does a router do?'),/another way. What does a router do\?/);
  assert.equal(conversation.reply('clarify','en','Q',' A model rephrasing '),' A model rephrasing ');
  assert.match(conversation.reply('unclear','ar','Q'),/لم أسمع/);
});
test('a clarification that copies the evidence is detected as a leak',()=>{
  const chunks=[{id:'c1',text:'A router selects the best path for a packet by consulting its routing table and forwarding the packet to the next hop.'}];
  assert.equal(conversation.leaks('The question asks what job this device does when a packet arrives.',chunks),false);
  assert.equal(conversation.leaks('Remember: a router selects the best path for a packet by consulting its routing table.',chunks),true);
  assert.equal(conversation.leaks('',chunks),false);
});

const question={question:'What does a router do?',concept:'Routing',question_type:'initial',difficulty:'foundation',citations:['text-1'],follow_up_reason:''};
const assessment={understanding:60,accuracy:50,completeness:40,communication:80,feedback:'Partly right.',strengths:['Mentions packets'],improvements:['Explain path selection']};
const evidenceText='Routers select paths for packets by consulting a routing table before forwarding to the next hop.';
const session=(turns=[])=>({language:'en',expires_at:new Date(Date.now()+60000),server_now:new Date(),turns,context:{chunks:[{id:'text-1',section:'Network',text:evidenceText}]}});
const answered=()=>session([{question:question.question,concept:'Routing',question_type:'initial',citations:['text-1'],transcript:null,assessment:null,exchanges:[{kind:'repeat',transcript:'repeat'}]}]);
const reply=value=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));
function mock(values) {const bodies=[];let calls=0;global.fetch=async(_url,options)=>{bodies.push(JSON.parse(options.body));return values[Math.min(calls++,values.length-1)].clone();};return {calls:()=>calls,bodies};}

test('the decision contract carries intent and reply and the provider schema stays closed',()=>{
  assert.deepEqual(contracts.decisionJsonSchema.properties.intent,{type:'string',enum:['answer','repeat','clarify','dont_know','unclear']});
  assert.deepEqual(contracts.decisionJsonSchema.required,['intent','reply','assessment','next']);
  assert.equal(contracts.decision.safeParse({intent:'repeat',reply:null,assessment:null,next:null}).success,true);
  assert.equal(contracts.decision.safeParse({intent:'maybe',reply:null,assessment:null,next:null}).success,false);
  assert.equal(contracts.decision.safeParse({reply:null,assessment:null,next:question}).success,false);
});
test('the examiner is told about the current question, its exchanges and the follow-up rule',async()=>{
  const {bodies}=mock([reply({intent:'answer',reply:null,assessment,next:{...question,question:'How does it choose the path?',question_type:'follow_up'}})]);
  await examiner.next(answered(),'It sends packets somewhere.');
  const user=JSON.parse(bodies[0].messages[1].content);
  assert.deepEqual(user.current_question.exchanges_so_far,[{kind:'repeat',student_said:'repeat'}]);
  assert.equal(user.consecutive_follow_ups,0);
  assert.equal(user.student_response,'It sends packets somewhere.');
  assert.match(bodies[0].messages[0].content,/follow_up on the same concept targeting exactly what was missing/);
  assert.match(bodies[0].messages[0].content,/never state, hint at, quote or paraphrase the correct answer/);
});
test('a control intent may not score or advance, and a clarification may not reveal the evidence',async()=>{
  let m=mock([reply({intent:'repeat',reply:null,assessment,next:question}),reply({intent:'repeat',reply:null,assessment:null,next:null})]);
  assert.deepEqual(await examiner.next(answered(),'Please repeat that question for me once more'),{intent:'repeat',reply:null,assessment:null,next:null});
  assert.equal(m.calls(),2);
  m=mock([reply({intent:'clarify',reply:`Remember that ${evidenceText}`,assessment:null,next:null}),reply({intent:'clarify',reply:'What job does this device do when a packet arrives?',assessment:null,next:null})]);
  const clarified=await examiner.next(answered(),'Sorry, I am really not following what you are asking me here');
  assert.equal(clarified.reply,'What job does this device do when a packet arrives?');assert.equal(m.calls(),2);
  mock([reply({intent:'clarify',reply:null,assessment:null,next:null})]);
  await assert.rejects(()=>examiner.next(answered(),'Sorry, I am really not following what you are asking me here'),{code:'missing_reply'});
  mock([reply({intent:'answer',reply:null,assessment:null,next:question})]);
  await assert.rejects(()=>examiner.next(answered(),'A router forwards packets.'),{code:'missing_assessment'});
  mock([reply({intent:'repeat',reply:null,assessment:null,next:null})]);
  await assert.rejects(()=>examiner.next(session(),null),{code:'invalid_initial_decision'});
});
test('reply generation asks only about the current question and rejects the requested intent being ignored',async()=>{
  let m=mock([reply({intent:'dont_know',reply:'No problem. Tell me anything you recall about how packets travel.',assessment:null,next:null})]);
  const nudge=await examiner.reply(answered(),'I don\'t know','dont_know');
  assert.equal(nudge.reply,'No problem. Tell me anything you recall about how packets travel.');
  const user=JSON.parse(m.bodies[0].messages[1].content);
  assert.equal(user.current_question.question,question.question);assert.deepEqual(user.evidence.map(c=>c.id),['text-1']);
  m=mock([reply({intent:'answer',reply:null,assessment,next:question}),reply({intent:'clarify',reply:'In simpler words, what is its role?',assessment:null,next:null})]);
  assert.equal((await examiner.reply(answered(),'I do not understand','clarify')).reply,'In simpler words, what is its role?');assert.equal(m.calls(),2);
  m=mock([reply({intent:'clarify',reply:`Well, ${evidenceText}`,assessment:null,next:null})]);
  await assert.rejects(()=>examiner.reply(answered(),'I do not understand','clarify'),{code:'reply_reveals_evidence'});assert.equal(m.calls(),2);
});
test('evaluation failures map to safe reason codes',()=>{
  assert.equal(examiner.failureCode(Object.assign(new Error(),{name:'ZodError'})),'invalid_model_output');
  assert.equal(examiner.failureCode(new SyntaxError('bad json')),'invalid_model_output');
  assert.equal(examiner.failureCode(Object.assign(new Error(),{name:'TimeoutError'})),'timeout');
  assert.equal(examiner.failureCode(new TypeError('fetch failed')),'network');
  assert.equal(examiner.failureCode(new Error('other')),'unknown');
});
