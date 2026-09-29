import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import OralExamPage from '../pages/OralExamPage';
import {oralExamService as api} from '../services/oralExam';
const voice=vi.hoisted(()=>({state:'idle',error:'',mic:false,muted:false,question:'',checkMic:vi.fn(),connect:vi.fn(),stop:vi.fn(),toggleMute:vi.fn()}));
vi.mock('../hooks/useOralExamVoice',()=>({useOralExamVoice:()=>voice}));
vi.mock('../services/oralExam',()=>({oralExamService:{status:vi.fn(),materials:vi.fn(),sessions:vi.fn(),get:vi.fn(),create:vi.fn(),start:vi.fn(),end:vi.fn(),evaluate:vi.fn()}}));
const session={id:'exam-1',material_title:'Computer networks',language:'en',status:'ready',turns:[],evaluation_status:'pending'};
beforeEach(()=>{
  vi.resetAllMocks();Object.assign(voice,{state:'idle',error:'',mic:false,muted:false,question:''});
  api.status.mockResolvedValue({data:{enabled:true}});api.materials.mockResolvedValue({data:{materials:[{kind:'lecture',id:'lecture-1',title:'Computer networks'}]}});api.sessions.mockResolvedValue({data:{sessions:[]}});
  api.create.mockResolvedValue({data:{session}});api.get.mockResolvedValue({data:{session}});voice.checkMic.mockResolvedValue(true);
});
const open=(path='/dashboard/oral-exam')=>render(<MemoryRouter initialEntries={[path]}><OralExamPage/></MemoryRouter>);
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
it('refreshing an active exam offers reconnect instead of restarting the timer',async()=>{
  api.get.mockResolvedValue({data:{session:{...session,status:'active',expires_at:new Date(Date.now()+120000).toISOString(),server_now:new Date().toISOString()}}});
  open('/dashboard/oral-exam?session=exam-1');await screen.findByRole('button',{name:'Reconnect'});expect(api.start).not.toHaveBeenCalled();
});
it('shows disabled and recoverable feedback failure states without invented scores',async()=>{
  api.get.mockResolvedValue({data:{session:{...session,status:'timed_out',evaluation_status:'failed'}}});
  open('/dashboard/oral-exam?session=exam-1');await screen.findByText(/Your answers are saved/);expect(screen.queryByText('out of 100')).not.toBeInTheDocument();expect(screen.getByRole('button',{name:'Retry feedback'})).toBeEnabled();
});
it('preselects a transcript from LectureScribe and links results back to its lecture tools',async()=>{
  api.materials.mockResolvedValue({data:{materials:[{kind:'transcript',id:'job-9',title:'Routing lecture'}]}});
  open('/dashboard/oral-exam?transcript=job-9');
  await waitFor(()=>expect(screen.getByLabelText('Saved lecture')).toHaveValue('transcript:job-9'));
  api.get.mockResolvedValue({data:{session:{...session,status:'completed',evaluation_status:'ready',source:{kind:'transcript',id:'job-9'},evaluation:{score:70,understanding:70,accuracy:70,completeness:70,communication:70,strengths:[],areasForImprovement:['Subnetting'],topicsCovered:['Routing'],summary:'Solid basics.'}}}});
  open('/dashboard/oral-exam?session=exam-1');
  expect(await screen.findByRole('link',{name:/Ask this lecture/})).toHaveAttribute('href','/dashboard/youtube?job=job-9&tool=chat');
  expect(screen.getByRole('link',{name:/Practice questions/})).toHaveAttribute('href','/dashboard/youtube?job=job-9&tool=quiz');
});
it('rejects unsupported uploads and leaves the existing tools available',async()=>{
  open();const input=await screen.findByLabelText(/Upload notes/);fireEvent.change(input,{target:{files:[new File(['binary'],'notes.pdf',{type:'application/pdf'})]}});
  await screen.findByRole('alert');expect(screen.getByRole('alert')).toHaveTextContent('UTF-8 .txt');expect(api.create).not.toHaveBeenCalled();
});
