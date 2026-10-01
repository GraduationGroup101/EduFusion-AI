import {fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter,useLocation} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import LectureScribePage from '../pages/LectureScribePage';
import {lectureToolsService as tools} from '../services/lectureTools';
import {lectureStudyService as study} from '../services/lectureStudy';
import {lectureScribeService} from '../services/api';
import toast from 'react-hot-toast';
vi.mock('../context/AuthContext',()=>({useAuth:()=>({user:{role:'student'}})}));
vi.mock('../services/lectureStudy',()=>({lectureStudyService:{status:vi.fn(),list:vi.fn(),create:vi.fn(),import:vi.fn()}}));
vi.mock('../services/lectureTools',()=>({lectureToolsService:{status:vi.fn(),history:vi.fn(),ask:vi.fn(),clear:vi.fn(),quizzes:vi.fn(),generate:vi.fn()}}));
vi.mock('../services/api',()=>({lectureScribeService:{health:vi.fn(),listJobs:vi.fn(),getJob:vi.fn(),getTranscript:vi.fn(),createJob:vi.fn()},studentService:{getPredictionData:vi.fn()}}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}));
const Where=()=>{const location=useLocation();return <output data-testid="location">{location.pathname+location.search}</output>;};
const page=(entry='/dashboard/lecturescribe')=>render(<MemoryRouter initialEntries={[entry]}><LectureScribePage/><Where/></MemoryRouter>);
const job={job_id:'job-1',status:'completed',submitted_at:1,title:'Networks lecture',request:{youtube_url:'https://youtu.be/abcdefghijk'},result:{cleaned_transcript_path:'/x'}};
const quiz={id:'quiz-1',created_at:new Date().toISOString(),questions:[
  {id:'q001',type:'mcq',prompt:'What selects a path?',choices:['Router','Cable','Screen','Mouse'],answer_index:0,answer:'',explanation:'Routers select paths.'},
  {id:'q002',type:'essay',prompt:'Explain routing.',choices:[],answer_index:null,answer:'Routers choose paths.',explanation:''},
]};
beforeEach(()=>{
  vi.clearAllMocks();
  study.status.mockResolvedValue({data:{enabled:false}});
  tools.status.mockResolvedValue({data:{enabled:true}});tools.history.mockResolvedValue({data:{messages:[]}});tools.quizzes.mockResolvedValue({data:{quizzes:[]}});
  lectureScribeService.health.mockResolvedValue({data:{status:'ok'}});lectureScribeService.listJobs.mockResolvedValue({data:{jobs:[job]}});
  lectureScribeService.getJob.mockResolvedValue({data:job});lectureScribeService.getTranscript.mockResolvedValue({data:'Packets travel through routers.'});
});
it('opens grounded lecture chat for a completed transcript without the local study library',async()=>{
  tools.ask.mockResolvedValue({data:{answer:'A router selects the path.',sources:['A router selects the best path'],covered:true}});
  page();
  fireEvent.click(await screen.findByRole('button',{name:'Ask this lecture'}));
  const dialog=await screen.findByRole('dialog',{name:'Networks lecture'});
  fireEvent.change(within(dialog).getByLabelText('Question about this lecture'),{target:{value:'What does a router do?'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Send question'}));
  await within(dialog).findByText('A router selects the path.');
  expect(tools.ask).toHaveBeenCalledWith('job-1','What does a router do?');
  expect(within(dialog).getByText('“A router selects the best path”')).toBeInTheDocument();
  expect(within(dialog).getByRole('link',{name:/Oral exam on this lecture/})).toHaveAttribute('href','/dashboard/oral-exam?transcript=job-1');
  expect(study.import).not.toHaveBeenCalled();
});
it('generates and self-checks practice questions from the transcript',async()=>{
  tools.generate.mockResolvedValue({data:{quiz}});
  page();
  fireEvent.click(await screen.findByRole('button',{name:'Generate questions'}));
  const dialog=await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button',{name:/Generate questions/}));
  await within(dialog).findByText('1. What selects a path?');
  expect(tools.generate).toHaveBeenCalledWith('job-1',{num_mcq:4,num_tf:3,num_essay:1,language:'auto'});
  fireEvent.click(within(dialog).getByLabelText('Cable'));
  fireEvent.change(within(dialog).getByLabelText('Essay answer 2'),{target:{value:'They pick routes.'}});
  fireEvent.click(within(dialog).getByRole('button',{name:'Check answers'}));
  expect(await within(dialog).findByText('Review this answer')).toBeInTheDocument();
  expect(within(dialog).getByText('Routers choose paths.')).toBeInTheDocument();
  expect(within(dialog).getByRole('status')).toHaveTextContent('Objective score: 0/1');
});
it('shows a cached transcript immediately and keeps tools hidden when the server has no model key',async()=>{
  tools.status.mockResolvedValue({data:{enabled:false}});
  lectureScribeService.createJob.mockResolvedValue({data:{...job,cached:true}});
  page();
  fireEvent.change(await screen.findByLabelText('YouTube lecture URL'),{target:{value:'https://youtu.be/abcdefghijk'}});
  fireEvent.click(screen.getByRole('button',{name:'Create transcript'}));
  await screen.findByText('Packets travel through routers.');
  expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/already transcribed/));
  expect(screen.getByRole('heading',{name:'Transcript ready'})).toBeInTheDocument();
  expect(screen.getAllByRole('button',{name:'Ask this lecture'}).every(button=>button.disabled)).toBe(true);
});
it('opens the lecture tools from an Oral Exam deep link',async()=>{
  page('/dashboard/lecturescribe?job=job-1&tool=quiz');
  const dialog=await screen.findByRole('dialog');
  await waitFor(()=>expect(within(dialog).getByRole('button',{name:'Practice questions'})).toHaveAttribute('aria-pressed','true'));
  expect(lectureScribeService.getJob.mock.calls[0][0]).toBe('job-1');
  // The tool is consumed once (a refresh must not reopen it); the open lecture stays in the URL.
  await waitFor(()=>expect(screen.getByTestId('location')).toHaveTextContent('/dashboard/lecturescribe?job=job-1'));
  expect(screen.getByTestId('location')).not.toHaveTextContent('tool=');
});
