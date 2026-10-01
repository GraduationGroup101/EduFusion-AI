import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter,Route,Routes,useLocation} from 'react-router-dom';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import LectureScribePage from '../pages/LectureScribePage';
import TranscriptView, {parseTranscript,stripModelWrapper} from '../components/lectures/TranscriptView';
import LectureToolsPanel from '../components/lectures/LectureToolsPanel';
import Sidebar from '../components/layout/Sidebar';
import {LegacyLectureScribeRedirect} from '../App';
import {lectureScribeService as scribe} from '../services/api';
import {lectureToolsService as tools} from '../services/lectureTools';
import {lectureStudyService as study} from '../services/lectureStudy';
import toast from 'react-hot-toast';
const auth=vi.hoisted(()=>({user:null}));
vi.mock('../context/AuthContext',()=>({useAuth:()=>({user:auth.user,logout:vi.fn()}),AuthProvider:({children})=>children}));
vi.mock('../services/api',()=>({
  lectureScribeService:{health:vi.fn(),listJobs:vi.fn(),getJob:vi.fn(),getTranscript:vi.fn(),createJob:vi.fn(),adminSaves:vi.fn()},
  studentService:{getPredictionData:vi.fn()},authService:{me:vi.fn()},default:{},
}));
vi.mock('../services/lectureStudy',()=>({lectureStudyService:{status:vi.fn(),list:vi.fn(),adminList:vi.fn(),create:vi.fn(),import:vi.fn()}}));
vi.mock('../services/lectureTools',()=>({lectureToolsService:{status:vi.fn(),history:vi.fn(),ask:vi.fn(),clear:vi.fn(),quizzes:vi.fn(),generate:vi.fn()}}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()},Toaster:()=>null}));

const Where=()=>{const location=useLocation();return <output data-testid="location">{location.pathname+location.search+location.hash}</output>;};
const page=(entry='/dashboard/lecturescribe')=>render(<MemoryRouter initialEntries={[entry]}><LectureScribePage/><Where/></MemoryRouter>);
const httpError=(status,data)=>Object.assign(new Error('Request failed with status code '+status),{response:{status,data}});
const url='https://youtu.be/abcdefghijk';
const completed={job_id:'job-1',status:'completed',submitted_at:1790000000,title:'Networks lecture',youtube_url:url,language:'en',detected_language:'en',mode:'formatted',
  request:{youtube_url:url,clean:true,language:'en'},result:{has_cleaned:true,has_raw:true,cleaned_transcript_path:'stored'}};
const running=(id,extra={})=>({job_id:id,status:'running',stage:'transcribing',stage_label:'Transcribing audio.',progress_percent:40,current_step:2,total_steps:5,
  submitted_at:1790000100,title:'Live lecture',youtube_url:'https://youtu.be/livelecture1',language:'auto',mode:'formatted',
  request:{youtube_url:'https://youtu.be/livelecture1',clean:true,language:'auto'},...extra});

beforeEach(()=>{
  auth.user={id:7,role:'student',username:'sara'};
  study.status.mockResolvedValue({data:{enabled:false}});
  tools.status.mockResolvedValue({data:{enabled:false}});tools.history.mockResolvedValue({data:{messages:[]}});tools.quizzes.mockResolvedValue({data:{quizzes:[]}});
  scribe.health.mockResolvedValue({data:{status:'ok'}});
  scribe.listJobs.mockResolvedValue({data:{jobs:[completed]}});
  scribe.getJob.mockImplementation(async(id)=>({data:id==='job-1'?completed:running(id)}));
  scribe.getTranscript.mockResolvedValue({data:'Packets travel through routers.'});
  scribe.adminSaves.mockResolvedValue({data:{saves:[],total:0}});
});
afterEach(()=>{vi.unstubAllGlobals();});

it('redirects old /dashboard/youtube links to /dashboard/lecturescribe without losing the deep link',async()=>{
  render(<MemoryRouter initialEntries={['/dashboard/youtube?job=job-1&tool=quiz#notes']}><Routes>
    <Route path="/dashboard/youtube/*" element={<LegacyLectureScribeRedirect/>}/>
    <Route path="/dashboard/lecturescribe" element={<Where/>}/>
  </Routes></MemoryRouter>);
  expect(await screen.findByTestId('location')).toHaveTextContent('/dashboard/lecturescribe?job=job-1&tool=quiz#notes');
});
it('links the sidebar to the new LectureScribe path',()=>{
  vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()})));
  render(<MemoryRouter><Sidebar onMobileClose={()=>{}}/></MemoryRouter>);
  expect(screen.getByRole('link',{name:'LectureScribe'})).toHaveAttribute('href','/dashboard/lecturescribe');
});
it('always sends the chosen language and mode, including automatic detection',async()=>{
  scribe.createJob.mockResolvedValueOnce({data:{job_id:'job-new',status:'queued'}}).mockResolvedValueOnce({data:{job_id:'job-ar',status:'queued'}});
  page();
  fireEvent.change(await screen.findByLabelText('YouTube lecture URL'),{target:{value:url}});
  fireEvent.click(screen.getByRole('button',{name:'Create transcript'}));
  await waitFor(()=>expect(scribe.createJob).toHaveBeenCalledWith({youtube_url:url,clean:true,language:'auto'}));
  fireEvent.change(screen.getByLabelText('Lecture language'),{target:{value:'ar'}});
  fireEvent.click(screen.getByLabelText(/Fast output/));
  fireEvent.change(screen.getByLabelText('YouTube lecture URL'),{target:{value:url}});
  fireEvent.click(await screen.findByRole('button',{name:'Create transcript'}));
  await waitFor(()=>expect(scribe.createJob).toHaveBeenLastCalledWith({youtube_url:url,clean:false,language:'ar'}));
});
it('restores a running lecture after leaving the page and coming back',async()=>{
  scribe.createJob.mockResolvedValue({data:{job_id:'job-run',status:'queued'}});
  const view=page();
  fireEvent.change(await screen.findByLabelText('YouTube lecture URL'),{target:{value:url}});
  fireEvent.click(screen.getByRole('button',{name:'Create transcript'}));
  expect(await screen.findByRole('heading',{name:'Processing lecture'})).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('?job=job-run'));
  view.unmount();
  scribe.getJob.mockClear();
  page('/dashboard/lecturescribe');
  expect(await screen.findByRole('heading',{name:'Processing lecture'})).toBeInTheDocument();
  await waitFor(()=>expect(scribe.getJob).toHaveBeenCalledWith('job-run',expect.anything()));
  expect(screen.getByTestId('location')).toHaveTextContent('/dashboard/lecturescribe?job=job-run');
});
it('opens a lecture submitted just before leaving the page, while the slow service was still answering',async()=>{
  let answer;
  scribe.createJob.mockReturnValue(new Promise((resolve)=>{answer=resolve;}));
  const view=page();
  fireEvent.change(await screen.findByLabelText('YouTube lecture URL'),{target:{value:url}});
  fireEvent.click(screen.getByRole('button',{name:'Create transcript'}));
  expect(await screen.findByRole('button',{name:'Submitting'})).toBeDisabled();
  view.unmount();
  page('/dashboard/lecturescribe');
  // The submission is still waiting: the new page says so instead of offering a second one.
  expect(await screen.findByRole('button',{name:'Submitting'})).toBeDisabled();
  expect(await screen.findByRole('button',{name:/Networks lecture/})).toBeInTheDocument();
  await act(async()=>{answer({data:{job_id:'job-slow',status:'queued'}});});
  expect(await screen.findByRole('heading',{name:'Processing lecture'})).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('?job=job-slow'));
  expect(scribe.getJob).toHaveBeenCalledWith('job-slow',expect.anything());
  expect(toast.success).toHaveBeenCalledWith('Lecture submitted');
  expect(screen.getByRole('button',{name:'Create transcript'})).toBeEnabled();
});
it('restores a lecture whose slow submission finished while the student was on another page',async()=>{
  let answer;
  scribe.createJob.mockReturnValue(new Promise((resolve)=>{answer=resolve;}));
  const view=page();
  fireEvent.change(await screen.findByLabelText('YouTube lecture URL'),{target:{value:url}});
  fireEvent.click(screen.getByRole('button',{name:'Create transcript'}));
  await screen.findByRole('button',{name:'Submitting'});
  view.unmount();
  await act(async()=>{answer({data:{job_id:'job-away',status:'queued'}});});
  // The server saves the lecture only after answering, so the list read on return may not have it yet.
  page('/dashboard/lecturescribe');
  expect(await screen.findByRole('heading',{name:'Processing lecture'})).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('?job=job-away'));
  expect(sessionStorage.getItem('edufusion:lecturescribe:active:student:7:submitting')).toBeNull();
});
it('after a reload during a slow submission, opens the lecture once the server has saved it',async()=>{
  vi.useFakeTimers({shouldAdvanceTime:true});
  try {
    const marker='edufusion:lecturescribe:active:student:7:submitting';
    // An older lecture with the same settings is not mistaken for the new one.
    const older={...completed,job_id:'job-old',title:'Older lecture',language:'ar',mode:'fast',request:{youtube_url:url,clean:false,language:'ar'}};
    const saved=running('job-late',{status:'queued',language:'ar',mode:'fast',request:{youtube_url:url,clean:false,language:'ar'}});
    sessionStorage.setItem(marker,JSON.stringify({at:Date.now(),language:'ar',mode:'fast',known:['job-1','job-old']}));
    scribe.listJobs.mockResolvedValueOnce({data:{jobs:[completed,older]}}).mockResolvedValue({data:{jobs:[saved,completed,older]}});
    page();
    await screen.findByRole('button',{name:/Networks lecture/});
    expect(screen.getByTestId('location')).not.toHaveTextContent('?job=');
    await act(()=>vi.advanceTimersByTimeAsync(5000));
    await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('?job=job-late'));
    expect(sessionStorage.getItem(marker)).toBeNull();
  } finally {vi.useRealTimers();}
});
it('shows a queued lecture’s place in the queue instead of a stage countdown',async()=>{
  const queued=running('job-queued',{status:'queued',stage:'queued',stage_label:'Waiting for the current job to finish.',progress_percent:0,
    current_step:0,stage_started_at:Date.now()/1000-60,estimated_stage_seconds:30,jobs_ahead:2});
  scribe.listJobs.mockResolvedValue({data:{jobs:[queued]}});
  scribe.getJob.mockResolvedValue({data:queued});
  page('/dashboard/lecturescribe?job=job-queued');
  const viewer=await screen.findByRole('region',{name:'Processing lecture'});
  expect(await within(viewer).findByText('2 lectures are ahead of yours')).toBeInTheDocument();
  expect(within(viewer).queryByText(/finishing up|Stage estimate/)).not.toBeInTheDocument();
  expect(within(viewer).queryByText(/will start shortly/)).not.toBeInTheDocument();
});
it('drops a malformed lecture link instead of reconnecting to it forever',async()=>{
  scribe.getJob.mockRejectedValue(httpError(400,{error:'Invalid job ID'}));
  page('/dashboard/lecturescribe?job=job-1.');
  await waitFor(()=>expect(toast.error).toHaveBeenCalledWith('That lecture could not be found.',expect.anything()));
  await waitFor(()=>expect(screen.getByTestId('location')).not.toHaveTextContent('?job='));
  expect(screen.queryByText(/Reconnecting/)).not.toBeInTheDocument();
  expect(scribe.getJob).toHaveBeenCalledTimes(1);
  expect(sessionStorage.getItem('edufusion:lecturescribe:active:student:7')).toBeNull();
});
it('opens only an administrator’s own running lecture by itself, never another account’s',async()=>{
  auth.user={id:1,role:'admin',username:'admin'};
  const student=running('job-student',{submitted_at:1790000900,title:'Student lecture',saved_by:[{owner_key:'student:5',type:'student',id:2005,name:'Mona Ali'}],saved_count:1});
  const own=running('job-own',{submitted_at:1790000100,title:'Admin lecture',saved_by:[{owner_key:'user:1',type:'user',id:1,name:'admin',role:'admin'}],saved_count:1});
  scribe.listJobs.mockResolvedValue({data:{scope:'all',jobs:[student]}});
  const view=page();
  expect(await screen.findByRole('button',{name:/Student lecture/})).toBeInTheDocument();
  expect(screen.getByTestId('location')).not.toHaveTextContent('?job=');
  expect(scribe.getJob).not.toHaveBeenCalled();
  view.unmount();
  scribe.listJobs.mockResolvedValue({data:{scope:'all',jobs:[student,own]}});
  page();
  await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('?job=job-own'));
  expect(scribe.getJob).not.toHaveBeenCalledWith('job-student',expect.anything());
});
it('opens a lecture tool deep link once the study library has answered, even when it answers last',async()=>{
  let studyReady;
  study.status.mockReturnValue(new Promise((resolve)=>{studyReady=resolve;}));
  study.list.mockResolvedValue({data:{lectures:[]}});
  study.import.mockReturnValue(new Promise(()=>{}));
  page('/dashboard/lecturescribe?job=job-1&tool=chat');
  expect(await screen.findByText('Packets travel through routers.')).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByTestId('location')).not.toHaveTextContent('tool='));
  expect(toast.error).not.toHaveBeenCalled();
  expect(study.import).not.toHaveBeenCalled();
  await act(async()=>{studyReady({data:{enabled:true,worker_online:true}});});
  await waitFor(()=>expect(study.import).toHaveBeenCalledWith('job-1',expect.any(String)));
  expect(toast.error).not.toHaveBeenCalled();
});
it('opens the newest lecture still processing when there is nothing to restore, listed first',async()=>{
  scribe.listJobs.mockResolvedValue({data:{jobs:[completed,running('job-live',{submitted_at:1})]}});
  page();
  expect(await screen.findByRole('heading',{name:'Processing lecture'})).toBeInTheDocument();
  expect(scribe.getJob.mock.calls[0][0]).toBe('job-live');
  const rows=within(screen.getByRole('list',{name:'Lecture transcriptions'})).getAllByRole('listitem');
  expect(rows[0]).toHaveTextContent('Live lecture');
});
it('keeps saved lectures usable while the transcription service is asleep',async()=>{
  scribe.health.mockRejectedValue(httpError(504,{error:'Gateway timeout'}));
  scribe.getTranscript.mockResolvedValue({data:'# Routing\n\nPackets travel through routers.'});
  scribe.createJob.mockRejectedValue(httpError(503,{error:'Service unavailable'}));
  page();
  expect(await screen.findByText(/Waking up the transcription service/)).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button',{name:/Networks lecture/}));
  expect(await screen.findByText('Packets travel through routers.')).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Routing'})).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('YouTube lecture URL'),{target:{value:url}});
  fireEvent.click(screen.getByRole('button',{name:'Create transcript'}));
  expect(await screen.findByText(/waking up or offline/)).toBeInTheDocument();
  expect(screen.getByText('Packets travel through routers.')).toBeInTheDocument();
});
it('keeps a running lecture on screen and reconnects when a status check fails',async()=>{
  scribe.listJobs.mockResolvedValue({data:{jobs:[running('job-live')]}});
  scribe.getJob.mockRejectedValueOnce(httpError(503,{error:'Service unavailable'}))
    .mockResolvedValue({data:running('job-live',{stage_label:'Formatting the transcript.',progress_percent:80})});
  page('/dashboard/lecturescribe?job=job-live');
  const viewer=await screen.findByRole('region',{name:'Processing lecture'});
  expect(await within(viewer).findByText(/Reconnecting to the transcription service/)).toBeInTheDocument();
  expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
  expect(toast.error).not.toHaveBeenCalled();
  expect(await within(viewer).findByText('Formatting the transcript.',{},{timeout:6000})).toBeInTheDocument();
  expect(within(viewer).queryByText(/Reconnecting/)).not.toBeInTheDocument();
},10000);
it('shows a reconnecting state while the backend reports the provider unavailable',async()=>{
  scribe.listJobs.mockResolvedValue({data:{jobs:[]}});
  scribe.getJob.mockResolvedValue({data:running('job-live',{provider_unavailable:true})});
  page('/dashboard/lecturescribe?job=job-live');
  expect(await screen.findByText(/Reconnecting to the transcription service/)).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Processing lecture'})).toBeInTheDocument();
});
it('explains a lecture lost by a service restart and submits it again with the same settings',async()=>{
  const lost=running('job-lost',{status:'failed',lost:true,error:'The transcription service restarted before this lecture finished. Submit it again.',
    language:'ar',mode:'fast',youtube_url:url,request:{youtube_url:url,clean:false,language:'ar'}});
  scribe.listJobs.mockResolvedValue({data:{jobs:[lost]}});
  scribe.getJob.mockImplementation(async(id)=>({data:id==='job-lost'?lost:running(id)}));
  scribe.createJob.mockResolvedValue({data:{job_id:'job-again',status:'queued'}});
  page('/dashboard/lecturescribe?job=job-lost');
  expect(await screen.findByRole('heading',{name:'Lecture interrupted'})).toBeInTheDocument();
  expect(screen.getByText(/restarted before this lecture finished/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Submit again'}));
  await waitFor(()=>expect(scribe.createJob).toHaveBeenCalledWith({youtube_url:url,clean:false,language:'ar'}));
  await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('?job=job-again'));
});
it('labels a formatted request that came back unformatted and formats it again on request',async()=>{
  const fellBack={...completed,produced_mode:'fast',result:{...completed.result,produced_mode:'fast'}};
  scribe.listJobs.mockResolvedValue({data:{jobs:[fellBack]}});
  scribe.getJob.mockImplementation(async(id)=>({data:id==='job-1'?fellBack:running(id)}));
  scribe.createJob.mockResolvedValue({data:{job_id:'job-formatted',status:'queued'}});
  page('/dashboard/lecturescribe?job=job-1');
  expect(await screen.findByText(/AI formatting was unavailable/)).toBeInTheDocument();
  const viewer=screen.getByRole('region',{name:'Transcript ready'});
  expect(within(viewer).queryByText('Better formatting')).not.toBeInTheDocument();
  expect(within(viewer).getByText('Automatic paragraphs')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Format again'}));
  await waitFor(()=>expect(scribe.createJob).toHaveBeenCalledWith({youtube_url:url,clean:true,language:'en'}));
  await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('?job=job-formatted'));
});
it('keeps the formatted label when the formatted output was really produced',async()=>{
  const formatted={...completed,produced_mode:'formatted'};
  scribe.listJobs.mockResolvedValue({data:{jobs:[formatted]}});
  scribe.getJob.mockImplementation(async(id)=>({data:id==='job-1'?formatted:running(id)}));
  page('/dashboard/lecturescribe?job=job-1');
  await screen.findByText('Packets travel through routers.');
  const viewer=screen.getByRole('region',{name:'Transcript ready'});
  expect(within(viewer).getByText('Better formatting')).toBeInTheDocument();
  expect(screen.queryByText(/AI formatting was unavailable/)).not.toBeInTheDocument();
});
it('marks a running lecture the server no longer knows as interrupted instead of polling forever',async()=>{
  scribe.listJobs.mockResolvedValue({data:{jobs:[running('job-gone')]}});
  scribe.getJob.mockRejectedValue(httpError(404,{error:'Job not found'}));
  page('/dashboard/lecturescribe?job=job-gone');
  expect(await screen.findByRole('heading',{name:'Lecture interrupted'})).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Submit again'})).toBeEnabled();
  expect(scribe.getJob).toHaveBeenCalledTimes(1);
});
it('shows why a finished transcript cannot be loaded and retries on request',async()=>{
  scribe.getTranscript.mockRejectedValue(httpError(404,'{"error":"Transcript not found for this lecture"}'));
  page('/dashboard/lecturescribe?job=job-1');
  expect(await screen.findByText('Transcript not found for this lecture')).toBeInTheDocument();
  expect(screen.queryByText(/Loading transcript/)).not.toBeInTheDocument();
  scribe.getTranscript.mockResolvedValue({data:'Packets travel through routers.'});
  fireEvent.click(screen.getByRole('button',{name:'Try again'}));
  expect(await screen.findByText('Packets travel through routers.')).toBeInTheDocument();
});
it('never shows one lecture’s transcript under another lecture',async()=>{
  const a={...completed,job_id:'job-a',title:'Lecture A'},b={...completed,job_id:'job-b',title:'Lecture B'};
  const pendingA=[];
  scribe.listJobs.mockResolvedValue({data:{jobs:[a,b]}});
  scribe.getJob.mockImplementation(async(id)=>({data:id==='job-a'?a:b}));
  scribe.getTranscript.mockImplementation((id)=>id==='job-a'?new Promise((resolve)=>pendingA.push(()=>resolve({data:'Text of lecture A'}))):Promise.resolve({data:'Text of lecture B'}));
  page();
  fireEvent.click(await screen.findByRole('button',{name:/Lecture A/}));
  await waitFor(()=>expect(pendingA.length).toBeGreaterThan(0));
  fireEvent.click(screen.getByRole('button',{name:/Lecture B/}));
  expect(await screen.findByText('Text of lecture B')).toBeInTheDocument();
  await act(async()=>{pendingA.forEach((release)=>release());});
  expect(screen.queryByText('Text of lecture A')).not.toBeInTheDocument();
  expect(screen.getByText('Text of lecture B')).toBeInTheDocument();
});
it('keeps the open transcript when a new submission fails',async()=>{
  scribe.createJob.mockRejectedValue(httpError(429,{error:'Hourly lecture limit reached. Try again later.'}));
  page('/dashboard/lecturescribe?job=job-1');
  expect(await screen.findByText('Packets travel through routers.')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('YouTube lecture URL'),{target:{value:url}});
  fireEvent.click(screen.getByRole('button',{name:'Create transcript'}));
  expect(await screen.findByText('Hourly lecture limit reached. Try again later.')).toBeInTheDocument();
  expect(screen.getByText('Packets travel through routers.')).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Transcript ready'})).toBeInTheDocument();
});
it('keeps a running lecture one click away while another lecture is open',async()=>{
  scribe.listJobs.mockResolvedValue({data:{jobs:[completed,running('job-live')]}});
  page('/dashboard/lecturescribe?job=job-1');
  expect(await screen.findByRole('heading',{name:'Transcript ready'})).toBeInTheDocument();
  fireEvent.click(await screen.findByRole('button',{name:'1 lecture processing'}));
  expect(await screen.findByRole('heading',{name:'Processing lecture'})).toBeInTheDocument();
  expect(screen.getByTestId('location')).toHaveTextContent('?job=job-live');
});
it('renders an Arabic transcript right-to-left with real headings and per-block direction',()=>{
  const cleaned='إليك النص المنسق:\n\n# مقدمة في الشبكات\n\nتنتقل **الحزم** عبر الموجهات في الشبكة، ويستخدم بروتوكول TCP للتحقق من وصولها.\n\n- TCP هو بروتوكول موثوق يضمن وصول البيانات\n- TCP protocol overview in English\n\n1. الخطوة الأولى\n2. الخطوة الثانية';
  render(<TranscriptView cleaned={cleaned} raw="نص أصلي كما قيل في المحاضرة عن الشبكات والحزم والموجهات." title="محاضرة الشبكات" language="ar"/>);
  const panel=screen.getByRole('tabpanel');
  expect(panel).toHaveAttribute('dir','rtl');
  expect(panel).toHaveAttribute('lang','ar');
  expect(within(panel).getByRole('heading',{name:'مقدمة في الشبكات'})).toBeInTheDocument();
  expect(panel).not.toHaveTextContent('#');
  expect(panel).not.toHaveTextContent('**');
  expect(panel).not.toHaveTextContent('إليك النص');
  expect(within(panel).getByText('الحزم').tagName).toBe('STRONG');
  expect(panel.querySelectorAll('p,li,h3,h4,h5').length).toBeGreaterThan(4);
  expect(within(panel).getByRole('heading',{name:'مقدمة في الشبكات'})).toHaveAttribute('dir','rtl');
  expect(within(panel).getByText(/ويستخدم بروتوكول/).closest('p')).toHaveAttribute('dir','rtl');
  // An Arabic sentence that opens with an English term still reads right-to-left; an English line stays left-to-right.
  expect(within(panel).getByText('TCP هو بروتوكول موثوق يضمن وصول البيانات').closest('li')).toHaveAttribute('dir','rtl');
  expect(within(panel).getByText('TCP protocol overview in English').closest('li')).toHaveAttribute('dir','ltr');
  expect(within(panel).getAllByRole('listitem')).toHaveLength(4);
  fireEvent.click(screen.getByRole('tab',{name:/Original/}));
  expect(screen.getByRole('tabpanel')).toHaveTextContent('نص أصلي كما قيل في المحاضرة');
});
it('renders English Markdown without raw markers and hides a version that does not exist',()=>{
  const {unmount}=render(<TranscriptView cleaned={'Here is the cleaned transcript:\n\n## Transport layer\n\nTCP gives **reliable** delivery.\n\n- Multiplexing\n- Congestion control'} raw="" language="en"/>);
  expect(screen.getByRole('heading',{name:'Transport layer'})).toBeInTheDocument();
  expect(screen.getByRole('tabpanel')).toHaveAttribute('dir','ltr');
  expect(screen.getByRole('tabpanel')).not.toHaveTextContent('##');
  expect(screen.queryByText(/Here is the cleaned transcript/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('tab')).toHaveLength(1);
  expect(screen.getByText('9 words')).toBeInTheDocument();
  unmount();
  // A legacy raw transcript is one long paragraph: it is split at sentence ends without changing any word or number.
  const raw='The bits 0 1 1 0 repeat in version 3.5 of the protocol. '.repeat(30);
  render(<TranscriptView raw={raw} language="en"/>);
  expect(screen.getByRole('tab',{name:/Original/})).toHaveAttribute('aria-selected','true');
  expect(screen.queryByRole('tab',{name:/Formatted/})).not.toBeInTheDocument();
  const paragraphs=screen.getByRole('tabpanel').querySelectorAll('p');
  expect(paragraphs.length).toBeGreaterThan(3);
  expect([...paragraphs].map((paragraph)=>paragraph.textContent).join(' ')).toBe(raw.trim());
});
it('keeps a "#" that belongs to a heading and still drops a closing "#" sequence',()=>{
  const heading=(line)=>parseTranscript(line)[0];
  expect(heading('## Programming in C#')).toEqual({type:'h',level:2,text:'Programming in C#'});
  expect(heading('## مقدمة في لغة C#').text).toBe('مقدمة في لغة C#');
  expect(heading('### F# basics').text).toBe('F# basics');
  expect(heading('## Intro ##').text).toBe('Intro');
  expect(heading('# Title #').text).toBe('Title');
  expect(heading('## C# ##').text).toBe('C#');
});
it('removes only model wrappers, never lecture text that looks like one',()=>{
  // Lecture speech that ends with a colon, and a lecturer's own note, stay in the view, the copy and the download.
  for (const text of ["Here is today's agenda:\n- TCP\n- UDP",'فيما يلي أهم النقاط:\n- الشبكات\n- الحزم','فيما يلي النصف الثاني من المحاضرة:\n\nتنتقل الحزم.',
    'Packets travel through routers.\n\nNote: I have uploaded the slides to Moodle, so please review them before Sunday.',
    'Packets travel.\n\nNote: I kept '+'the routing table small for this example and '.repeat(8)+'that is all.'])
    expect(stripModelWrapper(text)).toBe(text);
  expect(stripModelWrapper('Here is the cleaned transcript:\n\n## Routing\n\nPackets travel.')).toBe('## Routing\n\nPackets travel.');
  expect(stripModelWrapper('**Here is the formatted version of the text:**\n\nPackets travel.')).toBe('Packets travel.');
  expect(stripModelWrapper('إليك النص المنسق:\n\nتنتقل الحزم عبر الموجهات.')).toBe('تنتقل الحزم عبر الموجهات.');
  expect(stripModelWrapper('Packets travel.\n\nNote: I have kept the technical terms in English.')).toBe('Packets travel.');
  expect(stripModelWrapper('Packets travel.\n\n(Note: I\'ve removed filler words.)')).toBe('Packets travel.');
  render(<TranscriptView cleaned={"Here is today's agenda:\n- TCP\n- UDP"} language="en"/>);
  expect(screen.getByRole('tabpanel')).toHaveTextContent("Here is today's agenda:");
});
it('copies the transcript and reports a clipboard failure instead of failing silently',async()=>{
  const writeText=vi.fn().mockRejectedValue(new Error('denied'));
  const execCommand=document.execCommand;
  Object.defineProperty(navigator,'clipboard',{value:{writeText},configurable:true});
  document.execCommand=vi.fn(()=>false);
  try {
    render(<TranscriptView cleaned="A short lecture transcript about routers." language="en"/>);
    fireEvent.click(screen.getByRole('button',{name:'Copy'}));
    await waitFor(()=>expect(toast.error).toHaveBeenCalledWith(expect.stringMatching(/Copy failed/)));
    expect(writeText).toHaveBeenCalledWith('A short lecture transcript about routers.');
    expect(toast.success).not.toHaveBeenCalled();
  } finally {delete navigator.clipboard;document.execCommand=execCommand;}
});
it('lists every student save for administrators with search, paging and who saved each lecture',async()=>{
  auth.user={id:1,role:'admin',username:'admin'};
  const save=(n)=>({owner:{owner_key:'student:'+n,type:'student',id:2000+n,name:'Student '+n,email:null,role:null},job_id:'job-'+n,title:'Lecture '+n,
    youtube_url:'https://youtu.be/v'+n,language:'ar',detected_language:'ar',mode:'formatted',status:'completed',saved_at:1790000000,has_transcript:true});
  scribe.listJobs.mockResolvedValue({data:{jobs:[{...completed,saved_by:[{owner_key:'student:5',type:'student',id:2005,name:'Mona Ali'},
    {owner_key:'student:6',type:'student',id:2006,name:'Omar Saleh'},{owner_key:'user:1',type:'user',id:1,name:'admin',role:'admin'}],saved_count:3}]}});
  scribe.adminSaves.mockImplementation(async({q,offset})=>({data:q?{saves:[save(1)],total:1}:{saves:Array.from({length:15},(_,i)=>save(i+offset)),total:40}}));
  page();
  const list=await screen.findByRole('list',{name:'Saved lectures by student'});
  expect(await within(list).findByText('Student 0')).toBeInTheDocument();
  expect(within(list).getByText('Student ID 2000')).toBeInTheDocument();
  expect(scribe.adminSaves).toHaveBeenCalledWith({q:'',limit:15,offset:0},expect.anything());
  expect(screen.getByText('Showing 1–15 of 40')).toBeInTheDocument();
  expect(screen.getByText(/Saved by Mona Ali, Omar Saleh \+1/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Next saved lectures'}));
  await waitFor(()=>expect(scribe.adminSaves).toHaveBeenLastCalledWith({q:'',limit:15,offset:15},expect.anything()));
  fireEvent.change(screen.getByRole('searchbox',{name:'Search saved lectures by student'}),{target:{value:'Student 1'}});
  await waitFor(()=>expect(scribe.adminSaves).toHaveBeenLastCalledWith({q:'Student 1',limit:15,offset:0},expect.anything()));
  fireEvent.click(await within(list).findByRole('button',{name:'Open Lecture 1 saved by Student 1'}));
  await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('?job=job-1'));
  expect(await screen.findByText(/Saved by Mona Ali \(ID 2005\), Omar Saleh \(ID 2006\), admin/)).toBeInTheDocument();
});
it('keeps focus in the lecture chat when its parent re-renders',()=>{
  const job={job_id:'job-1',title:'Networks lecture'};
  const view=render(<MemoryRouter><LectureToolsPanel job={job} onClose={()=>{}}/></MemoryRouter>);
  const question=screen.getByLabelText('Question about this lecture');
  question.focus();
  view.rerender(<MemoryRouter><LectureToolsPanel job={job} onClose={()=>{}}/></MemoryRouter>);
  expect(document.activeElement).toBe(question);
});
