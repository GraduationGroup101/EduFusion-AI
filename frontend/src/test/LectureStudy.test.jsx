import {act,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import LectureWorkspace from '../components/lectures/LectureWorkspace';
import LectureLibrary from '../components/lectures/LectureLibrary';
import LectureScribePage from '../pages/LectureScribePage';
import {lectureStudyService as service} from '../services/lectureStudy';
import {lectureScribeService} from '../services/api';
vi.mock('../services/lectureStudy',()=>({lectureStudyService:{
  status:vi.fn(),list:vi.fn(),lecture:vi.fn(),messages:vi.fn(),quizzes:vi.fn(),attempts:vi.fn(),recommendations:vi.fn(),
  ask:vi.fn(),generate:vi.fn(),quiz:vi.fn(),submit:vi.fn(),job:vi.fn(),retry:vi.fn(),clearMessages:vi.fn(),
  remove:vi.fn(),create:vi.fn(),import:vi.fn(),
}}));
vi.mock('../services/api',()=>({
  lectureScribeService:{health:vi.fn(),listJobs:vi.fn(),getJob:vi.fn(),getTranscript:vi.fn(),createJob:vi.fn()},
  studentService:{getPredictionData:vi.fn()},
}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}));
const lecture=(id='lecture-a')=>({id,title:'Lecture '+id,status:'ready',stage:'ready',summary:'A saved networking summary',
  sections:[{id:'s001',title:'Packets',summary:'Packets follow routes.',citations:['c0001']}],
  concepts:['Routing'],chunks:[{id:'c0001',text:'Packets follow routes.',section:'s001'}],jobs:[]});
const quiz={id:'quiz-a',questions:[
  {id:'q001',type:'mcq',prompt:'How do packets travel?',choices:['Routes','Trees','Cars','Clouds'],concept:'Routing',citations:['c0001']},
  {id:'q002',type:'tf',prompt:'Packets follow routes.',choices:[],concept:'Routing',citations:['c0001']},
]};
beforeEach(()=>{
  vi.clearAllMocks();
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
it('keeps saved lecture chat available when the transcription service is offline',async()=>{
  lectureScribeService.health.mockRejectedValue(new Error('Offline'));
  render(<LectureScribePage/>);
  await screen.findByText('LectureScribe is taking a short break');
  fireEvent.click(await screen.findByRole('button',{name:'Ask this lecture'}));
  await screen.findByRole('dialog',{name:'Lecture lecture-a'});
  expect(screen.getByRole('textbox',{name:'Question about this lecture'})).toBeEnabled();
  expect(screen.getByText(/Local processing is offline/)).toBeInTheDocument();
});
it('creates queued lectures through the new service while preserving the legacy transcription endpoint',async()=>{
  service.create.mockResolvedValue({data:{lecture:lecture(),job:{id:'prepare-a',status:'queued'}}});
  render(<LectureScribePage/>);
  await screen.findByRole('button',{name:'Save lecture'});
  fireEvent.change(screen.getByLabelText('YouTube lecture URL'),{target:{value:'https://youtu.be/abcdefghijk'}});
  fireEvent.click(screen.getByRole('button',{name:'Save lecture'}));
  await waitFor(()=>expect(service.create).toHaveBeenCalledWith(expect.objectContaining({youtube_url:'https://youtu.be/abcdefghijk'}),expect.any(String)));
  expect(lectureScribeService.createJob).not.toHaveBeenCalled();
});
it('the lecture conversation submits only the selected lecture and persists a queued request',async()=>{
  render(<LectureWorkspace lectureId="lecture-a" initialTab="chat" onClose={()=>{}}/>);
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
  render(<LectureWorkspace lectureId="lecture-a" initialTab="chat" onClose={()=>{}}/>);
  fireEvent.click(await screen.findByRole('button',{name:'Source c0001'}));
  expect(screen.getByRole('button',{name:'Transcript'})).toHaveAttribute('aria-pressed','true');
  expect(document.getElementById('source-c0001')).toHaveTextContent('Packets follow routes.');
});
it('switching lectures discards late responses from the previous lecture',async()=>{
  let resolveFirst;
  service.lecture.mockImplementationOnce(()=>new Promise(resolve=>{resolveFirst=resolve;}));
  const close=()=>{};
  const view=render(<LectureWorkspace lectureId="lecture-a" onClose={close}/>);
  await waitFor(()=>expect(service.lecture).toHaveBeenCalledTimes(1));
  view.rerender(<LectureWorkspace lectureId="lecture-b" onClose={close}/>);
  await screen.findByRole('dialog',{name:'Lecture lecture-b'});
  await act(async()=>{resolveFirst({data:{lecture:lecture('lecture-a')}});});
  expect(screen.queryByRole('dialog',{name:'Lecture lecture-a'})).not.toBeInTheDocument();
  expect(screen.getByRole('dialog',{name:'Lecture lecture-b'})).toBeInTheDocument();
});
it('restores an unfinished question-generation request after reopening its lecture',async()=>{
  service.lecture.mockResolvedValue({data:{lecture:{...lecture(),jobs:[{id:'pending-quiz',kind:'quiz',status:'queued'}]}}});
  render(<LectureWorkspace lectureId="lecture-a" initialTab="quiz" onClose={()=>{}}/>);
  await screen.findByText(/Your quiz request is saved: queued/);
  expect(screen.getByRole('button',{name:'Generate lecture questions'})).toBeDisabled();
});
it('practice submits answers and links feedback to the lecture conversation',async()=>{
  service.quizzes.mockResolvedValue({data:{quizzes:[{id:'quiz-a',created_at:'2026-09-26T10:00:00Z'}]}});
  service.submit.mockResolvedValue({data:{attempt:{id:'attempt-a',score:1,total:2,
    feedback:quiz.questions.map((question,index)=>({...question,answer:index===0?0:true,correct:index===0,
      explanation:'Packets use routes.',rubric:[]}))}}});
  render(<LectureWorkspace lectureId="lecture-a" initialTab="quiz" onClose={()=>{}}/>);
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
  render(<LectureLibrary/>);
  const library=await screen.findByRole('region',{name:'Saved lecture library'});
  fireEvent.click(within(library).getByRole('button',{name:'Generate questions'}));
  await screen.findByRole('dialog',{name:'Lecture lecture-a'});
  expect(screen.getByRole('button',{name:'Practice questions'})).toHaveAttribute('aria-pressed','true');
  expect(service.lecture.mock.calls[0][0]).toBe('lecture-a');
});
