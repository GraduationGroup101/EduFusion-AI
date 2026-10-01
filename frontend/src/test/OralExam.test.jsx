import {act,render,screen,fireEvent,waitFor,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import OralExamPage from '../pages/OralExamPage';
import {oralExamService as api} from '../services/oralExam';
const voice=vi.hoisted(()=>({state:'idle',error:'',mic:false,muted:false,question:'',remark:null,checkMic:vi.fn(),connect:vi.fn(),stop:vi.fn(),toggleMute:vi.fn()}));
vi.mock('../hooks/useOralExamVoice',()=>({useOralExamVoice:update=>{voice.update=update;return voice;}}));
vi.mock('../services/oralExam',()=>({oralExamService:{status:vi.fn(),materials:vi.fn(),sessions:vi.fn(),get:vi.fn(),create:vi.fn(),start:vi.fn(),end:vi.fn(),evaluate:vi.fn()}}));
const session={id:'exam-1',material_title:'Computer networks',language:'en',status:'ready',turns:[],evaluation_status:'pending'};
beforeEach(()=>{
  vi.resetAllMocks();Object.assign(voice,{state:'idle',error:'',mic:false,muted:false,question:'',remark:null,audioUnavailable:false});
  api.status.mockResolvedValue({data:{enabled:true}});api.materials.mockResolvedValue({data:{materials:[{kind:'lecture',id:'lecture-1',title:'Computer networks'}]}});api.sessions.mockResolvedValue({data:{sessions:[]}});
  api.create.mockResolvedValue({data:{session}});api.get.mockResolvedValue({data:{session}});voice.checkMic.mockResolvedValue(true);
});
const open=(path='/dashboard/oral-exam')=>render(<MemoryRouter initialEntries={[path]}><OralExamPage/></MemoryRouter>);
it('shows the localized audio fallback alongside the question and an available microphone',async()=>{
  Object.assign(voice,{state:'listening',mic:true,audioUnavailable:true,question:'Explain routing.'});
  api.get.mockResolvedValue({data:{session:{...session,status:'active',expires_at:new Date(Date.now()+600000).toISOString(),server_now:new Date().toISOString()}}});
  open('/dashboard/oral-exam?session=exam-1');
  await screen.findByText('Audio is temporarily unavailable. You can continue with the question shown on screen.');
  expect(screen.getByRole('heading',{name:'Explain routing.'})).toBeInTheDocument();expect(screen.getByRole('button',{name:'Mute'})).toBeEnabled();expect(screen.queryByRole('button',{name:'Reconnect'})).toBeNull();
});
it('opening an unscored historical exam does not automatically request modern feedback',async()=>{
  api.get.mockResolvedValue({data:{session:{...session,status:'completed',evaluation_status:'unavailable',evaluation:{version:0,legacy:true,unscored:true,score:null,summary:'No complete evaluation was saved for this historical exam.'}}}});
  open('/dashboard/oral-exam?session=exam-1');
  await screen.findByText('Not scored');expect(api.evaluate).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:/Retry detailed feedback/})).toBeNull();
});
it('prepares owned material with a stable request key and shows the pre-exam microphone controls',async()=>{
  open();await screen.findByLabelText('Saved lecture');fireEvent.change(screen.getByLabelText('Saved lecture'),{target:{value:'lecture:lecture-1'}});
  fireEvent.click(screen.getByRole('button',{name:/Prepare exam/}));
  await screen.findByRole('button',{name:/Start oral exam/});expect(screen.getByText('Microphone not checked')).toBeInTheDocument();
  expect(api.create).toHaveBeenCalledWith({source:{kind:'lecture',id:'lecture-1'},language:'en'},expect.any(String));
  fireEvent.click(screen.getByRole('button',{name:'Check microphone'}));await waitFor(()=>expect(voice.checkMic).toHaveBeenCalledOnce());
});
it('does not start or consume examination time when microphone permission is denied',async()=>{
  voice.checkMic.mockResolvedValue(false);open('/dashboard/oral-exam?session=exam-1');
  fireEvent.click(await screen.findByRole('button',{name:/Start oral exam/}));
  await waitFor(()=>expect(voice.checkMic).toHaveBeenCalledOnce());expect(api.start).not.toHaveBeenCalled();
});
it('starts with authoritative time and ends into a persisted results view',async()=>{
  const active={...session,status:'active',expires_at:new Date(Date.now()+600000).toISOString(),server_now:new Date().toISOString()};
  const completed={...active,status:'completed',evaluation_status:'ready',evaluation:{score:82,understanding:86,accuracy:80,completeness:78,communication:80,strengths:['Path selection'],areasForImprovement:['Explain packets'],topicsCovered:['Routing'],summary:'Good understanding of routing.'}};
  api.start.mockResolvedValue({data:{session:active}});api.end.mockResolvedValue({data:{session:completed}});
  open('/dashboard/oral-exam?session=exam-1');fireEvent.click(await screen.findByRole('button',{name:/Start oral exam/}));
  await screen.findByRole('button',{name:'End exam'});expect(voice.connect).toHaveBeenCalledWith(active);
  expect(screen.getByLabelText('Time remaining')).toHaveTextContent('10:00');
  fireEvent.click(screen.getByRole('button',{name:'End exam'}));await screen.findByText('Good understanding of routing.');expect(screen.getByText('82')).toBeInTheDocument();expect(voice.stop).toHaveBeenCalled();
});
it('ending an exam replaces the live view immediately and shows feedback generating until the report arrives',async()=>{
  const active={...session,status:'active',expires_at:new Date(Date.now()+600000).toISOString(),server_now:new Date().toISOString(),turns:[{id:'t1',sequence:1,question:'What does a router do?',concept:'Routing',transcript:'It selects paths.'}]};
  api.get.mockResolvedValue({data:{session:active}});
  let finishEnd;api.end.mockImplementationOnce(()=>new Promise(resolve=>{finishEnd=resolve;}));
  let finishEvaluate;api.evaluate.mockImplementationOnce(()=>new Promise(resolve=>{finishEvaluate=resolve;}));
  open('/dashboard/oral-exam?session=exam-1');
  fireEvent.click(await screen.findByRole('button',{name:'End exam'}));
  // Before /end responds: the live panel is gone and the review shows progress.
  await screen.findByText('Your exam has ended.');
  expect(screen.queryByRole('button',{name:'End exam'})).toBeNull();
  expect(screen.queryByLabelText('Time remaining')).toBeNull();
  expect(screen.getByRole('button',{name:'Generating detailed feedback…'})).toBeDisabled();
  expect(voice.stop).toHaveBeenCalled();
  await act(async()=>finishEnd({data:{session:{...active,status:'completed',evaluation_status:'pending'},evaluation:{status:'pending'}}}));
  await waitFor(()=>expect(api.evaluate).toHaveBeenCalledTimes(1));
  expect(screen.getByRole('button',{name:'Generating detailed feedback…'})).toBeDisabled();
  await act(async()=>finishEvaluate({data:{session:{...active,status:'completed',evaluation_status:'ready',evaluation:{score:64,understanding:60,accuracy:65,completeness:60,communication:75,strengths:['Basics'],areasForImprovement:['Detail'],topicsCovered:['Routing'],summary:'A fair start.'}},evaluation:{status:'ready'}}}));
  await screen.findByText('A fair start.');expect(screen.getByText('64')).toBeInTheDocument();
  expect(api.start).not.toHaveBeenCalled();expect(api.end).toHaveBeenCalledTimes(1);
});
it('refreshing an active exam offers reconnect instead of restarting the timer',async()=>{
  api.get.mockResolvedValue({data:{session:{...session,status:'active',expires_at:new Date(Date.now()+120000).toISOString(),server_now:new Date().toISOString()}}});
  open('/dashboard/oral-exam?session=exam-1');await screen.findByRole('button',{name:'Reconnect'});expect(api.start).not.toHaveBeenCalled();
});
it('displays the stored remaining time immediately and a delayed poll cannot add time',async()=>{
  vi.useFakeTimers();
  try {
    const active={...session,status:'active',expires_at:new Date(Date.now()+120000).toISOString(),server_now:new Date().toISOString()};
    api.get.mockResolvedValue({data:{session:active}});
    await act(async()=>{open('/dashboard/oral-exam?session=exam-1');});
    expect(screen.getByLabelText('Time remaining')).toHaveTextContent('2:00');
    await act(async()=>{vi.advanceTimersByTime(10000);});
    expect(screen.getByLabelText('Time remaining')).toHaveTextContent('1:50');
  } finally {vi.useRealTimers();}
});
it('cancels in-flight status polling and never resurrects an ended exam from a late response',async()=>{
  vi.useFakeTimers();
  try {
    const active={...session,status:'active',expires_at:new Date(Date.now()+120000).toISOString(),server_now:new Date().toISOString()};
    api.get.mockResolvedValueOnce({data:{session:active}});
    let resolvePoll;
    api.get.mockImplementationOnce(()=>new Promise(resolve=>{resolvePoll=resolve;}));
    await act(async()=>{open('/dashboard/oral-exam?session=exam-1');});
    await act(async()=>{vi.advanceTimersByTime(10000);});
    const pollOptions=api.get.mock.calls.at(-1)[1];
    act(()=>voice.update({...active,status:'completed',evaluation_status:'ready'}));
    await act(async()=>{resolvePoll({data:{session:active}});});
    expect(screen.queryByRole('button',{name:'End exam'})).not.toBeInTheDocument();
    expect(pollOptions.signal.aborted).toBe(true);
  } finally {vi.useRealTimers();}
});
it('shows disabled and recoverable feedback failure states without invented scores',async()=>{
  api.get.mockResolvedValue({data:{session:{...session,status:'timed_out',evaluation_status:'failed'}}});
  open('/dashboard/oral-exam?session=exam-1');await screen.findByText(/Your answers are saved/);expect(screen.queryByText('out of 100')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Retry detailed feedback'})).toBeEnabled();
});
it('preselects a transcript from LectureScribe and links results back to its lecture tools',async()=>{
  api.materials.mockResolvedValue({data:{materials:[{kind:'transcript',id:'job-9',title:'Routing lecture'}]}});
  open('/dashboard/oral-exam?transcript=job-9');
  await waitFor(()=>expect(screen.getByLabelText('Saved lecture')).toHaveValue('transcript:job-9'));
  api.get.mockResolvedValue({data:{session:{...session,status:'completed',evaluation_status:'ready',source:{kind:'transcript',id:'job-9'},evaluation:{score:70,understanding:70,accuracy:70,completeness:70,communication:70,strengths:[],areasForImprovement:['Subnetting'],topicsCovered:['Routing'],summary:'Solid basics.'}}}});
  open('/dashboard/oral-exam?session=exam-1');
  expect(await screen.findByRole('link',{name:/Ask this lecture/})).toHaveAttribute('href','/dashboard/lecturescribe?job=job-9&tool=chat');
  expect(screen.getByRole('link',{name:/Practice questions/})).toHaveAttribute('href','/dashboard/lecturescribe?job=job-9&tool=quiz');
});
const turns=[{id:'t1',sequence:1,question:'What does a router do?',concept:'Routing',transcript:'It selects paths.',feedback:'Good start.',exchanges:[{kind:'repeat',transcript:'Repeat the question',reply:'Of course. Here is the question again.'},{kind:'clarification',transcript:"I don't understand",reply:'In other words, what job does this device do?'}]}];
const report={score:71,understanding:70,accuracy:72,completeness:70,communication:75,strengths:['Path selection'],areasForImprovement:['Subnetting'],topicsCovered:['Routing'],summary:'Solid basics.'};
it('retry feedback shows generating, then a clear failure, then the report, and sends one request per click',async()=>{
  const failed={...session,status:'timed_out',evaluation_status:'failed',evaluation_error:'model_unavailable',evaluation_attempts:1,turns};
  api.get.mockResolvedValue({data:{session:failed}});
  let resolveFirst;api.evaluate.mockImplementationOnce(()=>new Promise(resolve=>{resolveFirst=resolve;}));
  open('/dashboard/oral-exam?session=exam-1');
  const button=await screen.findByRole('button',{name:'Retry detailed feedback'});
  expect(screen.getByText(/feedback model is busy or unavailable/)).toBeInTheDocument();
  expect(screen.queryByText('out of 100')).not.toBeInTheDocument();
  fireEvent.click(button);fireEvent.click(button);
  const generating=await screen.findByRole('button',{name:'Generating detailed feedback…'});
  expect(generating).toBeDisabled();expect(generating).toHaveAttribute('aria-busy','true');
  expect(generating).toHaveAttribute('aria-busy','true');
  fireEvent.click(generating);
  expect(api.evaluate).toHaveBeenCalledTimes(1);expect(api.evaluate).toHaveBeenCalledWith('exam-1');
  await act(async()=>resolveFirst({data:{session:{...failed,evaluation_attempts:2,evaluation_error:'invalid_model_output'},evaluation:{status:'failed',error:'invalid_model_output'}}}));
  expect(await screen.findByText(/returned an unusable report/)).toBeInTheDocument();
  const retry=screen.getByRole('button',{name:'Retry detailed feedback'});expect(retry).toBeEnabled();
  api.evaluate.mockResolvedValueOnce({data:{session:{...failed,evaluation_status:'ready',evaluation_error:null,evaluation:report},evaluation:{status:'ready'}}});
  fireEvent.click(retry);
  await screen.findByText('Solid basics.');expect(screen.getByText('71')).toBeInTheDocument();expect(screen.getByText('out of 100')).toBeInTheDocument();
  expect(screen.queryByRole('button',{name:/feedback/i})).not.toBeInTheDocument();
  expect(api.evaluate).toHaveBeenCalledTimes(2);expect(api.start).not.toHaveBeenCalled();expect(api.end).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText('Review questions and answers'));
  expect(screen.getByText('It selects paths.')).toBeInTheDocument();
});
it('a request failure keeps the answers, explains it, and lets the student retry',async()=>{
  api.get.mockResolvedValue({data:{session:{...session,status:'completed',evaluation_status:'failed',evaluation_error:'timeout',turns}}});
  api.evaluate.mockRejectedValueOnce({response:{status:429,data:{error:'Too many requests. Please try again later.'}}});
  open('/dashboard/oral-exam?session=exam-1');
  expect(await screen.findByText(/took too long/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Retry detailed feedback'}));
  expect(await screen.findByText('Too many requests. Please try again later.')).toBeInTheDocument();
  expect(screen.getByRole('button',{name:'Retry detailed feedback'})).toBeEnabled();
  fireEvent.click(screen.getByText('Review questions and answers'));
  expect(screen.getByText('It selects paths.')).toBeInTheDocument();
});
it('pending feedback is requested once automatically and shows progress meanwhile',async()=>{
  const pending={...session,status:'completed',evaluation_status:'pending',turns};
  let resolveAuto;api.get.mockResolvedValue({data:{session:pending}});api.evaluate.mockImplementationOnce(()=>new Promise(resolve=>{resolveAuto=resolve;}));
  open('/dashboard/oral-exam?session=exam-1');
  const generating=await screen.findByRole('button',{name:'Generating detailed feedback…'});
  fireEvent.click(generating);
  await waitFor(()=>expect(api.evaluate).toHaveBeenCalledTimes(1));
  await act(async()=>resolveAuto({data:{session:{...pending,evaluation_status:'ready',evaluation:report},evaluation:{status:'ready'}}}));
  await screen.findByText('Solid basics.');expect(api.evaluate).toHaveBeenCalledTimes(1);
});
it('shows the examiner remark for a clarified question and keeps the question visible',async()=>{
  api.get.mockResolvedValue({data:{session:{...session,status:'active',expires_at:new Date(Date.now()+120000).toISOString(),server_now:new Date().toISOString(),turns}}});
  Object.assign(voice,{state:'listening',question:'What does a router do?',remark:{kind:'clarification',text:'In other words, what job does this device do?'}});
  open('/dashboard/oral-exam?session=exam-1');
  expect(await screen.findByRole('heading',{name:'What does a router do?'})).toBeInTheDocument();
  const remark=screen.getByRole('status',{name:'Clarification'});
  expect(remark).toHaveTextContent('In other words, what job does this device do?');
  expect(screen.getByText(/ask to repeat or clarify the question/)).toBeInTheDocument();
});
it('the review lists conversational exchanges under their question without treating them as answers',async()=>{
  api.get.mockResolvedValue({data:{session:{...session,status:'completed',evaluation_status:'ready',evaluation:report,turns}}});
  open('/dashboard/oral-exam?session=exam-1');
  await screen.findByText('Solid basics.');
  fireEvent.click(screen.getByText('Review questions and answers'));
  const article=screen.getByText('1. What does a router do?').closest('article');
  expect(within(article).getByText('Asked to repeat')).toBeInTheDocument();
  expect(within(article).getByText('Asked for clarification')).toBeInTheDocument();
  expect(within(article).getByText(/In other words, what job does this device do\?/)).toBeInTheDocument();
  expect(within(article).getByText('It selects paths.')).toBeInTheDocument();
});
