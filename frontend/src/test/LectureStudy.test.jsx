import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import LectureWorkspace, {transcriptVersions} from '../components/lectures/LectureWorkspace';
import LectureLibrary, {savedBy} from '../components/lectures/LectureLibrary';
import AdminLectureViewer from '../components/lectures/AdminLectureViewer';
import LectureScribePage from '../pages/LectureScribePage';
import {lectureStudyService as service} from '../services/lectureStudy';
import {lectureScribeService} from '../services/api';
const auth=vi.hoisted(()=>({user:{role:'student'}}));
vi.mock('../context/AuthContext',()=>({useAuth:()=>({user:auth.user})}));
vi.mock('../services/lectureStudy',()=>({lectureStudyService:{
  status:vi.fn(),list:vi.fn(),lecture:vi.fn(),transcript:vi.fn(),messages:vi.fn(),quizzes:vi.fn(),attempts:vi.fn(),recommendations:vi.fn(),
  ask:vi.fn(),generate:vi.fn(),quiz:vi.fn(),submit:vi.fn(),job:vi.fn(),retry:vi.fn(),clearMessages:vi.fn(),
  remove:vi.fn(),create:vi.fn(),import:vi.fn(),adminList:vi.fn(),adminLecture:vi.fn(),
}}));
vi.mock('../services/api',()=>({
  lectureScribeService:{health:vi.fn(),listJobs:vi.fn(),getJob:vi.fn(),getTranscript:vi.fn(),createJob:vi.fn()},
  studentService:{getPredictionData:vi.fn()},
}));
vi.mock('../services/lectureTools',()=>({lectureToolsService:{status:vi.fn().mockResolvedValue({data:{enabled:false}})}}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}));
// The study components link into the app (Oral Exam), so they render inside a router.
const routed=(ui)=>render(<MemoryRouter>{ui}</MemoryRouter>);
const lecture=(id='lecture-a')=>({id,title:'Lecture '+id,status:'ready',stage:'ready',summary:'A saved networking summary',
  sections:[{id:'s001',title:'Packets',summary:'Packets follow routes.',citations:['c0001']}],
  concepts:['Routing'],chunks:[{id:'c0001',text:'Packets follow routes.',section:'s001'}],jobs:[]});
const quiz={id:'quiz-a',questions:[
  {id:'q001',type:'mcq',prompt:'How do packets travel?',choices:['Routes','Trees','Cars','Clouds'],concept:'Routing',citations:['c0001']},
  {id:'q002',type:'tf',prompt:'Packets follow routes.',choices:[],concept:'Routing',citations:['c0001']},
]};
const ARABIC_CLEANED='## الشبكات\n\nTCP بروتوكول يضمن وصول الحزم بالترتيب الصحيح بين الأجهزة المختلفة.';
const ARABIC_RAW='TCP بروتوكول يضمن وصول الحزم بالترتيب الصحيح بين الأجهزة المختلفة والموجهات';
beforeEach(()=>{
  vi.clearAllMocks();
  auth.user={role:'student'};
  service.status.mockResolvedValue({data:{enabled:true,worker_online:false}});
  service.list.mockResolvedValue({data:{lectures:[lecture()]}});
  service.lecture.mockImplementation(async(id)=>({data:{lecture:lecture(id)}}));
  service.messages.mockResolvedValue({data:{messages:[]}});
  service.quizzes.mockResolvedValue({data:{quizzes:[]}});
  service.attempts.mockResolvedValue({data:{attempts:[]}});
  service.recommendations.mockResolvedValue({data:{weak_concepts:[],steps:['Complete a practice quiz'],prediction:null}});
  service.quiz.mockResolvedValue({data:{quiz}});
  service.ask.mockResolvedValue({data:{job:{id:'job-a',kind:'chat',status:'queued'}}});
  service.generate.mockResolvedValue({data:{job:{id:'job-quiz',kind:'quiz',status:'queued'}}});
  lectureScribeService.health.mockResolvedValue({data:{status:'ok'}});
  lectureScribeService.listJobs.mockResolvedValue({data:{jobs:[]}});
});
it('does not show an unusable lecture library when its tools are disabled',async()=>{
  service.status.mockResolvedValue({data:{enabled:false}});
  routed(<LectureScribePage/>);
  await screen.findByRole('button',{name:'Create transcript'});
  expect(screen.queryByRole('region',{name:'Saved lecture library'})).not.toBeInTheDocument();
  expect(service.list).not.toHaveBeenCalled();
});
it('lets administrators inspect all lecture content without loading student conversations',async()=>{
  auth.user={role:'admin'};
  service.adminList.mockResolvedValue({data:{lectures:[lecture('foreign-lecture')]}});
  service.adminLecture.mockResolvedValue({data:{lecture:{...lecture('foreign-lecture'),transcript:'A transcript from another account'}}});
  routed(<LectureLibrary/>);
  fireEvent.click(await screen.findByRole('button',{name:'View transcript and summary'}));
  await screen.findByText('A transcript from another account');
  expect(service.adminLecture).toHaveBeenCalledWith('foreign-lecture',expect.any(AbortSignal));
  expect(service.messages).not.toHaveBeenCalled();
  expect(screen.queryByRole('button',{name:/Remove .* from library/})).not.toBeInTheDocument();
});
it('shows administrators who saved each lecture, and the formatted and original transcripts',async()=>{
  auth.user={role:'admin'};
  const members=[{owner_key:'student:800',type:'student',id:800,name:'Amal Haddad',email:null,role:null,saved_at:'2026-09-30T10:00:00Z'},
    {owner_key:'student:801',type:'student',id:801,name:null,email:null,role:null,saved_at:'2026-09-30T11:00:00Z'},
    {owner_key:'user:1',type:'user',id:1,name:'root-admin',email:null,role:'admin',saved_at:'2026-09-30T12:00:00Z'},
    {owner_key:'student:802',type:'student',id:802,name:'Carim',email:null,role:null,saved_at:'2026-09-30T13:00:00Z'}];
  service.adminList.mockResolvedValue({data:{lectures:[{...lecture('shared-lecture'),member_count:5,members:members.slice(0,3)}]}});
  service.adminLecture.mockResolvedValue({data:{lecture:{...lecture('shared-lecture'),language:'ar',member_count:4,members,transcript:ARABIC_CLEANED,raw_transcript:ARABIC_RAW}}});
  routed(<LectureLibrary/>);
  expect(await screen.findByText('Saved by Amal Haddad (#800), Student 801, root-admin +2')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'View transcript and summary'}));
  const saved=await screen.findByRole('region',{name:'Saved by'});
  expect(within(saved).getByText('Saved by 4 accounts')).toBeInTheDocument();
  expect(within(saved).getByText('Amal Haddad')).toBeInTheDocument();
  expect(within(saved).getByText(/Student ID 801/)).toBeInTheDocument();
  expect(within(saved).getByText(/Admin/)).toBeInTheDocument();
  // The transcript renders as headings and right-to-left Arabic paragraphs, never raw Markdown.
  expect(screen.getByRole('heading',{name:'الشبكات'})).toHaveAttribute('dir','rtl');
  expect(screen.queryByText(/##/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab',{name:'Original'}));
  expect(screen.getByText(ARABIC_RAW).closest('p')).toHaveAttribute('dir','rtl');
});
it('does not count or name members who removed a lecture as current savers, but marks them in the viewer',async()=>{
  auth.user={role:'admin'};
  const removed={owner_key:'student:800',type:'student',id:800,name:'Amal Haddad',email:null,role:null,saved_at:'2026-09-30T10:00:00Z',removed_at:'2026-09-30T15:00:00Z'};
  const current={owner_key:'student:801',type:'student',id:801,name:'Badr',email:null,role:null,saved_at:'2026-09-30T11:00:00Z',removed_at:null};
  expect(savedBy({member_count:0,members:[removed]})).toBe('Not in any library now');
  expect(savedBy({member_count:1,members:[removed,current]})).toBe('Saved by Badr (#801)');
  service.adminList.mockResolvedValue({data:{lectures:[{...lecture('left-lecture'),member_count:1,members:[removed,current]}]}});
  service.adminLecture.mockResolvedValue({data:{lecture:{...lecture('left-lecture'),member_count:1,members:[removed,current],transcript:'Text'}}});
  routed(<LectureLibrary/>);
  expect(await screen.findByText('Saved by Badr (#801)')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'View transcript and summary'}));
  const saved=await screen.findByRole('region',{name:'Saved by'});
  expect(within(saved).getByText('Saved by 1 account')).toBeInTheDocument();
  const items=within(saved).getAllByRole('listitem');
  expect(items[0]).toHaveTextContent('Badr');
  expect(items[1]).toHaveTextContent('Amal Haddad');
  expect(items[1]).toHaveTextContent(/Removed/);
  expect(items[0]).not.toHaveTextContent(/Removed/);
});
it('shows an older import that stored the formatted text twice as formatted, and plain speech as the original',async()=>{
  const spoken='TCP بروتوكول يضمن وصول الحزم بالترتيب الصحيح بين الأجهزة.';
  expect(transcriptVersions({transcript:ARABIC_CLEANED,raw_transcript:ARABIC_CLEANED})).toEqual({cleaned:ARABIC_CLEANED,raw:null});
  expect(transcriptVersions({transcript:'Intro\n\n**TCP** is reliable.',raw_transcript:'Intro\n\n**TCP** is reliable.'})).toEqual({cleaned:'Intro\n\n**TCP** is reliable.',raw:null});
  expect(transcriptVersions({transcript:spoken,raw_transcript:spoken})).toEqual({cleaned:null,raw:spoken});
  expect(transcriptVersions({transcript:ARABIC_CLEANED,raw_transcript:ARABIC_RAW})).toEqual({cleaned:ARABIC_CLEANED,raw:ARABIC_RAW});
  expect(transcriptVersions({transcript:null,raw_transcript:null})).toEqual({cleaned:null,raw:null});
  auth.user={role:'admin'};
  service.adminLecture.mockResolvedValue({data:{lecture:{...lecture('legacy-import'),language:'ar',members:[],transcript:ARABIC_CLEANED,raw_transcript:ARABIC_CLEANED}}});
  routed(<AdminLectureViewer lectureId="legacy-import" onClose={()=>{}}/>);
  expect(await screen.findByRole('heading',{name:'الشبكات'})).toBeInTheDocument();
  expect(screen.getByRole('tab',{name:'Formatted'})).toHaveAttribute('aria-selected','true');
  expect(screen.queryByRole('tab',{name:'Original'})).not.toBeInTheDocument();
  expect(screen.queryByText(/exactly as it was spoken/)).not.toBeInTheDocument();
  expect(screen.getByRole('tabpanel')).not.toHaveTextContent('##');
});
it('makes every returned transcription accessible beyond the first eight jobs',async()=>{
  auth.user={role:'admin'};
  service.status.mockResolvedValue({data:{enabled:false}});
  lectureScribeService.listJobs.mockResolvedValue({data:{jobs:Array.from({length:10},(_,i)=>({job_id:'job-'+i,submitted_at:i,status:'completed',request:{youtube_url:'https://youtu.be/video'+i}}))}});
  routed(<LectureScribePage/>);
  await screen.findByText('https://youtu.be/video9');
  expect(screen.queryByText('https://youtu.be/video0')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Next transcriptions'}));
  expect(screen.getByText('https://youtu.be/video0')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox',{name:'Search lecture transcriptions'}),{target:{value:'video9'}});
  expect(screen.getByText('https://youtu.be/video9')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Next transcriptions'})).toBeDisabled();
});
it('keeps saved lecture chat available when the transcription service is offline',async()=>{
  lectureScribeService.health.mockRejectedValue(new Error('Offline'));
  routed(<LectureScribePage/>);
  await screen.findByText(/Waking up the transcription service/);
  fireEvent.click(await screen.findByRole('button',{name:'Ask this lecture'}));
  await screen.findByRole('dialog',{name:'Lecture lecture-a'});
  expect(screen.getByRole('textbox',{name:'Question about this lecture'})).toBeEnabled();
  expect(screen.getByText(/Local processing is offline/)).toBeInTheDocument();
});
it('creates queued lectures through the new service while its worker is online',async()=>{
  service.status.mockResolvedValue({data:{enabled:true,worker_online:true}});
  service.create.mockResolvedValue({data:{lecture:lecture(),job:{id:'prepare-a',status:'queued'}}});
  routed(<LectureScribePage/>);
  await screen.findByRole('button',{name:'Save lecture'});
  fireEvent.change(screen.getByLabelText('YouTube lecture URL'),{target:{value:'https://youtu.be/abcdefghijk'}});
  fireEvent.click(screen.getByRole('button',{name:'Save lecture'}));
  await waitFor(()=>expect(service.create).toHaveBeenCalledWith(expect.objectContaining({youtube_url:'https://youtu.be/abcdefghijk'}),expect.any(String)));
  expect(lectureScribeService.createJob).not.toHaveBeenCalled();
});
it('transcribes directly instead of queueing while the local study worker is offline',async()=>{
  lectureScribeService.createJob.mockResolvedValue({data:{job_id:'direct-job',status:'queued'}});
  lectureScribeService.getJob.mockResolvedValue({data:{job_id:'direct-job',status:'queued'}});
  routed(<LectureScribePage/>);
  await screen.findByRole('region',{name:'Saved lecture library'});
  fireEvent.change(screen.getByLabelText('YouTube lecture URL'),{target:{value:'https://youtu.be/abcdefghijk'}});
  fireEvent.click(screen.getByRole('button',{name:'Create transcript'}));
  await waitFor(()=>expect(lectureScribeService.createJob).toHaveBeenCalledWith(expect.objectContaining({youtube_url:'https://youtu.be/abcdefghijk',language:'auto'})));
  expect(service.create).not.toHaveBeenCalled();
});
it('the lecture conversation submits only the selected lecture and persists a queued request',async()=>{
  routed(<LectureWorkspace lectureId="lecture-a" initialTab="chat" onClose={()=>{}}/>);
  const question=await screen.findByRole('textbox',{name:'Question about this lecture'});
  await waitFor(()=>expect(question).toBeEnabled());
  fireEvent.change(question,{target:{value:'Explain routing'}});
  fireEvent.click(screen.getByRole('button',{name:'Send'}));
  await screen.findByText(/Your chat request is saved: queued/);
  expect(service.ask).toHaveBeenCalledWith('lecture-a','Explain routing',expect.any(String));
  expect(screen.getByRole('button',{name:'Send'})).toBeDisabled();
});
it('source references open the cited lecture text',async()=>{
  service.messages.mockResolvedValue({data:{messages:[{id:'message-a',question:'What are packets?',answer:'Packets follow routes.',citations:['c0001'],status:'completed'}]}});
  routed(<LectureWorkspace lectureId="lecture-a" initialTab="chat" onClose={()=>{}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Source c0001'}));
  expect(screen.getByRole('button',{name:'Sources'})).toHaveAttribute('aria-pressed','true');
  expect(document.getElementById('source-c0001')).toHaveTextContent('Packets follow routes.');
});
it('the transcript tab shows the full lecture transcript, loaded once, instead of overlapping sources',async()=>{
  service.lecture.mockResolvedValue({data:{lecture:{...lecture(),language:'auto',has_transcript:true}}});
  service.transcript.mockResolvedValue({data:{transcript:{id:'lecture-a',transcript:ARABIC_CLEANED,raw_transcript:ARABIC_RAW}}});
  routed(<LectureWorkspace lectureId="lecture-a" initialTab="summary" onClose={()=>{}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Transcript'}));
  // Arabic that opens with an English term still reads right-to-left.
  expect(await screen.findByRole('heading',{name:'الشبكات'})).toHaveAttribute('dir','rtl');
  expect(screen.getByText(/بروتوكول يضمن وصول الحزم بالترتيب الصحيح بين الأجهزة المختلفة\.$/).closest('p')).toHaveAttribute('dir','rtl');
  expect(screen.queryByText('Source c0001')).not.toBeInTheDocument();
  expect(screen.getByRole('tab',{name:'Original'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Summary'}));
  fireEvent.click(screen.getByRole('button',{name:'Transcript'}));
  await screen.findByRole('heading',{name:'الشبكات'});
  expect(service.transcript).toHaveBeenCalledTimes(1);
  expect(service.transcript).toHaveBeenCalledWith('lecture-a',expect.any(AbortSignal));
});
it('a transcript that fails to load explains why and can be retried',async()=>{
  service.lecture.mockResolvedValue({data:{lecture:{...lecture(),has_transcript:true}}});
  service.transcript.mockRejectedValueOnce({response:{data:{error:'Lecture study is temporarily unavailable.'}}})
    .mockResolvedValueOnce({data:{transcript:{transcript:'Routers forward packets between networks using routing tables.',raw_transcript:null}}});
  routed(<LectureWorkspace lectureId="lecture-a" initialTab="transcript" onClose={()=>{}}/>);
  expect(await screen.findByText('Lecture study is temporarily unavailable.')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  await screen.findByText('Routers forward packets between networks using routing tables.');
  expect(screen.queryByRole('tab',{name:'Original'})).not.toBeInTheDocument();
});
it('switching lectures discards late responses from the previous lecture',async()=>{
  let resolveFirst;
  service.lecture.mockImplementationOnce(()=>new Promise(resolve=>{resolveFirst=resolve;}));
  const close=()=>{};
  const view=routed(<LectureWorkspace lectureId="lecture-a" onClose={close}/>);
  await waitFor(()=>expect(service.lecture).toHaveBeenCalledTimes(1));
  view.rerender(<MemoryRouter><LectureWorkspace lectureId="lecture-b" onClose={close}/></MemoryRouter>);
  await screen.findByRole('dialog',{name:'Lecture lecture-b'});
  await act(async()=>{resolveFirst({data:{lecture:lecture('lecture-a')}});});
  expect(screen.queryByRole('dialog',{name:'Lecture lecture-a'})).not.toBeInTheDocument();
  expect(screen.getByRole('dialog',{name:'Lecture lecture-b'})).toBeInTheDocument();
});
it('restores an unfinished question-generation request after reopening its lecture',async()=>{
  service.lecture.mockResolvedValue({data:{lecture:{...lecture(),jobs:[{id:'pending-quiz',kind:'quiz',status:'queued'}]}}});
  routed(<LectureWorkspace lectureId="lecture-a" initialTab="quiz" onClose={()=>{}}/>);
  await screen.findByText(/Your quiz request is saved: queued/);
  expect(screen.getByRole('button',{name:'Generate lecture questions'})).toBeDisabled();
});
it.each(['chat','quiz'])('loads a completed %s result before stopping its polling request',async(kind)=>{
  vi.useFakeTimers();
  let finish;
  const job={id:'pending-result',kind,status:'running'};
  service.lecture.mockResolvedValue({data:{lecture:{...lecture(),jobs:[job]}}});
  service.job.mockResolvedValue({data:{job:{...job,status:'completed',result:{quiz_id:'quiz-a'}}}});
  const deferred=new Promise(resolve=>{finish=resolve;});
  if(kind==='chat')service.messages.mockResolvedValueOnce({data:{messages:[]}}).mockImplementationOnce(()=>deferred);
  else service.quiz.mockImplementationOnce(()=>deferred);
  let view;
  try {
    await act(async()=>{view=routed(<LectureWorkspace lectureId="lecture-a" initialTab={kind==='chat'?'chat':'quiz'} onClose={()=>{}}/>);});
    expect(screen.getByText(new RegExp('Your '+kind+' request is saved: running'))).toBeInTheDocument();
    await act(async()=>{await vi.advanceTimersByTimeAsync(3000);});
    await act(async()=>{finish(kind==='chat'?{data:{messages:[{id:'finished-message',question:'Packets?',answer:'Delivered answer',citations:['c0001']}]}}:{data:{quiz}});});
    expect(screen.queryByText(/Your .* request is saved:/)).not.toBeInTheDocument();
    if(kind==='chat')expect(screen.getByText('Delivered answer')).toBeInTheDocument();
    else expect(screen.getByText('1. How do packets travel?')).toBeInTheDocument();
  } finally {view?.unmount();vi.useRealTimers();}
});
it('practice submits answers and links feedback to the lecture conversation',async()=>{
  service.quizzes.mockResolvedValue({data:{quizzes:[{id:'quiz-a',created_at:'2026-09-26T10:00:00Z'}]}});
  service.submit.mockResolvedValue({data:{attempt:{id:'attempt-a',score:1,total:2,
    feedback:quiz.questions.map((question,index)=>({...question,answer:index===0?0:true,correct:index===0,
      explanation:'Packets use routes.',rubric:[]}))}}});
  routed(<LectureWorkspace lectureId="lecture-a" initialTab="quiz" onClose={()=>{}}/>);
  const select=await screen.findByLabelText('Saved question sets');
  fireEvent.change(select,{target:{value:'quiz-a'}});
  await screen.findByText('1. How do packets travel?');
  fireEvent.click(screen.getByLabelText('Routes'));
  fireEvent.click(screen.getByLabelText('False'));
  fireEvent.click(screen.getByRole('button',{name:'Submit practice answers'}));
  await screen.findByText(/Objective score: 1\/2/);
  expect(service.submit).toHaveBeenCalledWith('quiz-a',{q001:0,q002:false},expect.any(String));
  const feedbackButtons=screen.getAllByRole('button',{name:'Explain this answer in lecture chat'});
  expect(feedbackButtons[1]).toBeEnabled();fireEvent.click(feedbackButtons[1]);
  expect(screen.getByRole('textbox',{name:'Question about this lecture'})).toHaveValue('Explain the answer to this lecture question: Packets follow routes.');
});
it('library actions are scoped to the chosen lecture without navigating to global tools',async()=>{
  routed(<LectureLibrary/>);
  const library=await screen.findByRole('region',{name:'Saved lecture library'});
  fireEvent.click(within(library).getByRole('button',{name:'Generate questions'}));
  await screen.findByRole('dialog',{name:'Lecture lecture-a'});
  expect(screen.getByRole('button',{name:'Practice questions'})).toHaveAttribute('aria-pressed','true');
  expect(service.lecture.mock.calls[0][0]).toBe('lecture-a');
});
it('removing a lecture asks for confirmation first',async()=>{
  service.remove.mockResolvedValue({data:{success:true}});
  routed(<LectureLibrary/>);
  fireEvent.click(await screen.findByRole('button',{name:'Remove Lecture lecture-a from library'}));
  const confirm=await screen.findByRole('dialog',{name:'Remove this lecture from your library?'});
  fireEvent.click(within(confirm).getByRole('button',{name:'Cancel'}));
  expect(service.remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Remove Lecture lecture-a from library'}));
  fireEvent.click(within(await screen.findByRole('dialog',{name:'Remove this lecture from your library?'})).getByRole('button',{name:'Remove lecture'}));
  await waitFor(()=>expect(service.remove).toHaveBeenCalledWith('lecture-a'));
  await waitFor(()=>expect(screen.queryByRole('dialog',{name:'Remove this lecture from your library?'})).not.toBeInTheDocument());
});
it('a lecture the page focuses opens once, so an administrator can still return to all lectures',async()=>{
  auth.user={role:'admin'};
  service.adminList.mockResolvedValue({data:{lectures:[lecture('foreign-lecture')]}});
  routed(<LectureLibrary focusLecture={{id:'lecture-a',tab:'summary'}}/>);
  await screen.findByRole('dialog',{name:'Lecture lecture-a'});
  fireEvent.click(screen.getByRole('button',{name:'Close lecture workspace'}));
  fireEvent.click(screen.getByRole('button',{name:'All lectures'}));
  await waitFor(()=>expect(service.adminList).toHaveBeenCalled());
  expect(screen.getByRole('button',{name:'All lectures'})).toHaveAttribute('aria-pressed','true');
  expect(screen.queryByRole('dialog',{name:'Lecture lecture-a'})).not.toBeInTheDocument();
});
it('a closed focused lecture does not reopen when the student pages through the library',async()=>{
  service.list.mockResolvedValue({data:{lectures:Array.from({length:20},(_,index)=>lecture('page-'+index))}});
  routed(<LectureLibrary focusLecture={{id:'lecture-b',tab:'chat'}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Close lecture workspace'}));
  fireEvent.click(await screen.findByRole('button',{name:'Next'}));
  await waitFor(()=>expect(service.list).toHaveBeenCalledWith(20));
  expect(screen.queryByRole('dialog',{name:'Lecture lecture-b'})).not.toBeInTheDocument();
});
