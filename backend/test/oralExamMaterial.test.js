const assert=require('node:assert/strict');
const {before,after,test}=require('node:test');
const {randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const request=require('supertest');
const jwt=require('jsonwebtoken');
process.env.JWT_SECRET='oral-exam-material-test-secret-at-least-32';
process.env.NODE_ENV='test';
process.env.ORAL_EXAM_ENABLED='true';
for(const key of ['GROQ_API_KEY','ELEVENLABS_API_KEY','ELEVENLABS_EN_VOICE_ID','ELEVENLABS_AR_VOICE_ID'])process.env[key]='test-only';
const db=require('../src/db');
const app=require('../src/app');
const ingest=require('../src/oralExam/ingest');
const {openZip}=require('../src/oralExam/ingest/zip');
const docs=require('./helpers/documents');

const SENTENCE='Routers forward packets between networks using routing tables.';
const DOCX='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PPTX='application/vnd.openxmlformats-officedocument.presentationml.presentation';
let database;
const original={query:db.pool.query,connect:db.pool.connect};
// Uploads are rate limited per student, so each request uses the next test student.
let nextStudent=0;
const token=(id=910+(nextStudent++%30))=>'Bearer '+jwt.sign({id_student:id},process.env.JWT_SECRET);
const upload=(buffer,filename,contentType,auth=token())=>{
  const call=request(app).post('/api/oral-exam/materials/extract');
  if(auth)call.set('Authorization',auth);
  return call.attach('file',buffer,contentType?{filename,contentType}:{filename});
};

before(async()=>{
  database=await PGlite.create();
  db.pool.query=async(sql,params=[])=>{
    const result=!params.length&&sql.split(';').length>2?(await database.exec(sql)).at(-1):await database.query(sql,params);
    return {rows:result.rows||[],rowCount:result.affectedRows||result.rows?.length||0};
  };
  let tail=Promise.resolve();
  db.pool.connect=async()=>{const previous=tail;let release;tail=new Promise(r=>{release=r;});await previous;return {query:db.pool.query,release};};
  await require('../scripts/migrate').migrate();
  for(let id=910;id<=940;id++)await database.query("INSERT INTO students(id_student,student_name,pin_hash) VALUES($1,'Upload student','hash')",[id]);
});
after(async()=>{db.pool.query=original.query;db.pool.connect=original.connect;await database.close();await db.pool.end();});

test('unauthorized uploads are rejected before any parsing',async()=>{
  assert.equal((await upload(Buffer.from(SENTENCE.repeat(3)),'notes.txt','text/plain',null)).status,401);
  assert.equal((await upload(Buffer.from(SENTENCE.repeat(3)),'notes.txt','text/plain','Bearer not-a-token')).status,401);
});

test('an authorized student extracts TXT and Markdown as normalized text',async()=>{
  const txt=await upload(Buffer.from('\uFEFFNetworks\r\n\r\n\r\n\r\n'+SENTENCE+'   \u0000'.slice(0,3)+SENTENCE),'Week 3_notes.txt','text/plain');
  assert.equal(txt.status,200);
  assert.equal(txt.body.material.format,'txt');
  assert.equal(txt.body.material.title,'Week 3 notes');
  assert.equal(txt.body.material.text,`Networks\n\n${SENTENCE} ${SENTENCE}`);
  assert.equal(txt.body.material.truncation,null);
  const md=await upload(Buffer.from(`# Routing\n\n- ${SENTENCE}\n- ${SENTENCE}`),'routing.md','text/markdown');
  assert.equal(md.status,200);
  assert.match(md.body.material.text,/^# Routing\n\n- Routers/);
});

test('PDF text keeps page order and drops running headers and page numbers',async()=>{
  const page=n=>['Networking 101 - Course Notes',`Topic ${n}: ${['routing','switching','addressing'][n-1]} fundamentals`,SENTENCE,SENTENCE,String(n)];
  const response=await upload(docs.pdf([page(1),page(2),page(3)]),'lecture.pdf','application/pdf');
  assert.equal(response.status,200);
  const {material}=response.body;
  assert.equal(material.format,'pdf');
  assert.deepEqual(material.units,{kind:'page',count:3});
  assert.doesNotMatch(material.text,/Course Notes/);
  assert.match(material.text,/^\[Page 1\]\nTopic 1: routing fundamentals\nRouters/);
  assert.ok(material.text.indexOf('Topic 2')<material.text.indexOf('Topic 3'));
  assert.doesNotMatch(material.text,/^\d+$/m);
});

test('DOCX keeps headings, paragraphs and bullets without document metadata',async()=>{
  const file=docs.docx([{style:'Title',text:'Computer Networks'},{style:'Heading2',text:'Routing'},{text:SENTENCE},{list:true,text:'Static routes'},{list:true,text:'OSPF & BGP'},{text:SENTENCE}]);
  const response=await upload(file,'networks.docx',DOCX);
  assert.equal(response.status,200);
  assert.equal(response.body.material.text,`# Computer Networks\n\n## Routing\n\n${SENTENCE}\n\n- Static routes\n- OSPF & BGP\n\n${SENTENCE}`);
  assert.doesNotMatch(response.body.material.text,/Secret Author/);
});

test('PPTX follows presentation order, keeps notes and removes slide numbers',async()=>{
  const file=docs.pptx([{title:'Introduction',bullets:['Packets',SENTENCE],notes:'Stress the forwarding table.'},{title:'Routing protocols',bullets:['OSPF','BGP']}]);
  const response=await upload(file,'deck.pptx',PPTX);
  assert.equal(response.status,200);
  const {material}=response.body;
  assert.deepEqual(material.units,{kind:'slide',count:2});
  assert.equal(material.text,`## Slide 1: Introduction\n- Packets\n- ${SENTENCE}\n\nSpeaker notes: Stress the forwarding table.\n\n## Slide 2: Routing protocols\n- OSPF\n- BGP`);
  assert.doesNotMatch(material.text,/\b99\b/);
});

test('unsupported, legacy, image and executable files get specific explanations',async()=>{
  const cases=[
    [Buffer.from(SENTENCE),'notes.exe','application/octet-stream',415,/not supported/],
    [Buffer.from('\u00d0\u00cf\u0011\u00e0\u00a1\u00b1\u001a\u00e1'+'x'.repeat(200),'latin1'),'old.doc','application/msword',422,/damaged|encrypted/],
    [Buffer.from('\u0089PNG\r\n\u001a\n'+'x'.repeat(200),'latin1'),'board.png','image/png',415,/OCR/],
    [Buffer.from('MZ'+'x'.repeat(300),'latin1'),'notes.txt','text/plain',415,/Programs and scripts/],
    [docs.docx([{text:SENTENCE}]),'macro.docm','',415,/Macro-enabled/],
    [Buffer.from(SENTENCE.repeat(3)),'README','',415,/without an extension/],
  ];
  for(const [buffer,name,type,status,message] of cases){
    const response=await upload(buffer,name,type);
    assert.equal(response.status,status,name);
    assert.match(response.body.error,message,name);
  }
});

test('spoofed MIME types and renamed files are rejected by signature',async()=>{
  const mime=await upload(Buffer.from(SENTENCE.repeat(3)),'notes.txt','application/pdf');
  assert.equal(mime.status,415);assert.equal(mime.body.code,'type_mismatch');
  const renamed=await upload(Buffer.from(SENTENCE.repeat(3)),'notes.pdf','application/pdf');
  assert.equal(renamed.status,415);assert.equal(renamed.body.code,'signature_mismatch');
  const pdfAsDocx=await upload(docs.pdf([[SENTENCE]]),'notes.docx',DOCX);
  assert.equal(pdfAsDocx.body.code,'signature_mismatch');
  const docxAsPptx=await upload(docs.docx([{text:SENTENCE}]),'deck.pptx',PPTX);
  assert.equal(docxAsPptx.status,422);assert.match(docxAsPptx.body.error,/PowerPoint presentation/);
});

test('malformed documents and archive attacks fail safely',async()=>{
  const broken=await upload(Buffer.concat([Buffer.from('PK\u0003\u0004','latin1'),Buffer.alloc(200,7)]),'broken.docx',DOCX);
  assert.equal(broken.status,422);assert.equal(broken.body.code,'malformed');
  const badPdf=await upload(Buffer.from('%PDF-1.4\n'+'garbage '.repeat(40)),'broken.pdf','application/pdf');
  assert.equal(badPdf.status,422);
  // 40 MB of zeros compresses to ~40 KB: the ratio guard refuses to inflate it.
  const bomb=docs.zip({'[Content_Types].xml':'<Types/>','word/document.xml':Buffer.alloc(40*1024*1024)});
  const bombResponse=await upload(bomb,'bomb.docx',DOCX);
  assert.equal(bombResponse.status,422);assert.equal(bombResponse.body.code,'malformed');
  assert.throws(()=>openZip(docs.zip({'../../etc/passwd':'x'})),/Unsafe entry name/);
  assert.throws(()=>openZip(docs.zip({'C:/Windows/evil.xml':'x'})),/Unsafe entry name/);
  const traversal=await upload(docs.zip({'[Content_Types].xml':'<Types/>','../word/document.xml':'<w:body/>'}),'trick.docx',DOCX);
  assert.equal(traversal.status,422);
});

test('oversized, empty, too-short and scanned files are explained',async()=>{
  const big=await upload(Buffer.alloc(ingest.LIMITS.maxBytes+10,'a'),'huge.txt','text/plain');
  assert.equal(big.status,413);assert.match(big.body.error,/larger than 4 MB/);
  const empty=await upload(Buffer.alloc(0),'empty.txt','text/plain');
  assert.equal(empty.status,422);assert.match(empty.body.error,/empty/);
  const emptyDoc=await upload(docs.docx([]),'blank.docx',DOCX);
  assert.equal(emptyDoc.body.code,'empty');
  const short=await upload(Buffer.from('Routers forward packets.'),'short.txt','text/plain');
  assert.equal(short.status,422);assert.equal(short.body.code,'too_short');assert.match(short.body.error,/at least 100/);
  const scanned=await upload(docs.pdf([[],[],['Scan']]),'scan.pdf','application/pdf');
  assert.equal(scanned.status,422);assert.equal(scanned.body.code,'scanned');assert.match(scanned.body.error,/OCR/);
  // Mostly image-only pages with a text cover are scanned; a short but fully
  // selectable document is merely too short, never "scanned".
  const mostlyImages=await upload(docs.pdf([['Cover page title'],['Contents'],[],[],[],[],[],[],[],[]]),'album.pdf','application/pdf');
  assert.equal(mostlyImages.body.code,'scanned');
  const shortText=await upload(docs.pdf([['Routers forward packets.'],['Switches learn addresses.']]),'brief.pdf','application/pdf');
  assert.equal(shortText.status,422);assert.equal(shortText.body.code,'too_short');
  const latin1=await upload(Buffer.from('Caf\u00e9 '.repeat(40),'latin1'),'legacy.txt','text/plain');
  assert.equal(latin1.body.code,'encoding');
});

test('a sparse slide deck with selectable text on every page is accepted',async()=>{
  // Ten pages with fewer than 25 characters each used to be rejected as scanned.
  const topics=['Routing basics','Packet forwarding','Routing tables','Next hop choice','Static routes','Dynamic routes','Link cost','Convergence','Loops','Summary'];
  const deck=docs.pdf(topics.map((topic)=>[topic]));
  const response=await upload(deck,'deck.pdf','application/pdf');
  assert.equal(response.status,200,JSON.stringify(response.body));
  assert.match(response.body.material.text,/\[Page 10\]/);
  assert.equal(response.body.material.units.count,10);
});
test('long material is cut at a page boundary and the cut is reported',async()=>{
  const lines=Array.from({length:40},(_,i)=>`Line ${i} ${SENTENCE}`);
  const response=await upload(docs.pdf(Array.from({length:60},()=>lines)),'textbook.pdf','application/pdf');
  assert.equal(response.status,200);
  const {material}=response.body,cut=material.truncation;
  assert.ok(material.text.length<=ingest.LIMITS.maxChars);
  assert.equal(cut.kept_units.kind,'page');assert.equal(cut.kept_units.of,60);
  assert.ok(cut.kept_units.to>1&&cut.kept_units.to<60);
  assert.ok(material.text.endsWith(SENTENCE));
  assert.ok(cut.original_characters>cut.kept_characters);
});

test('extracted text creates an exam session through the existing text source',async()=>{
  const {body}=await upload(docs.docx([{style:'Heading1',text:'Routing'},{text:SENTENCE},{text:SENTENCE}]),'routing.docx',DOCX);
  const response=await request(app).post('/api/oral-exam/sessions').set('Authorization',token()).set('Idempotency-Key',randomUUID())
    .send({language:'en',source:{kind:'text',title:body.material.title,text:body.material.text}});
  assert.equal(response.status,201);
  assert.equal(response.body.session.material_title,'routing');
});

test('only a single file field is accepted',async()=>{
  const response=await request(app).post('/api/oral-exam/materials/extract').set('Authorization',token())
    .attach('file',Buffer.from(SENTENCE.repeat(3)),'a.txt').attach('file',Buffer.from(SENTENCE.repeat(3)),'b.txt');
  assert.equal(response.status,400);
  const json=await request(app).post('/api/oral-exam/materials/extract').set('Authorization',token()).send({text:'x'});
  assert.equal(json.status,400);
});

test('repeated oral uploads keep validation without an upload count quota',async()=>{
  const statuses=[];
  for(let i=0;i<21;i++)statuses.push((await upload(Buffer.alloc(0),'empty.txt','text/plain',token(940))).status);
  assert.equal(statuses.filter(s=>s===422).length,21);
});

test('decks exported without title placeholders get headings and lose repeated notices',async()=>{
  const slide=(n,heading,point)=>({title:'',bullets:[`${n} Copyright © 2023, Example Press. All rights reserved.`,heading,`• ${point}`,`-5 degrees: ${point} below freezing on the Celsius scale`]});
  const file=docs.pptx([slide(1,'Objectives','Insert rows'),slide(2,'Agenda','Update rows'),slide(3,'Transactions','Commit changes')]);
  const {body,status}=await upload(file,'exported.pptx',PPTX);
  assert.equal(status,200);
  assert.doesNotMatch(body.material.text,/Copyright/);
  assert.match(body.material.text,/^## Slide 1: Objectives\n- Insert rows\n- -5 degrees: Insert rows below freezing on the Celsius scale/);
  assert.match(body.material.text,/## Slide 3: Transactions\n- Commit changes/);
});

test('legacy DOC extracts text but rejects encrypted and macro-enabled documents',async()=>{
  const text=SENTENCE.repeat(3);
  const result=await upload(docs.doc(text),'notes.doc','application/msword');
  assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(result.body.material.text,text);
  for(const options of [{encrypted:true},{macro:true}]){
    const rejected=await upload(docs.doc(text,options),'protected.doc','application/msword');assert.equal(rejected.status,422);
  }
});

test('a 1.7 MB DOCX is accepted by the production Express route and unsafe filenames are stripped',async()=>{
  const file=docs.zip({'[Content_Types].xml':'<Types/>','word/document.xml':`<w:document><w:body><w:p><w:r><w:t>${SENTENCE.repeat(3)}</w:t></w:r></w:p></w:body></w:document>`,'word/media/image.bin':Buffer.alloc(1700000,42)},{store:true});
  const result=await upload(file,'Lab01.docx',DOCX);
  assert.equal(result.status,200,JSON.stringify(result.body));assert.match(result.body.material.text,/Routers/);
  const safe=await ingest.extractInWorker({name:'../../Lab01.docx',type:DOCX,buffer:new Uint8Array(file)});
  assert.equal(safe.file_name,'Lab01.docx');
});
