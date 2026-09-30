// Study-material upload on the Oral Exam setup page.
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import OralExamPage from '../pages/OralExamPage';
import {oralExamService as api} from '../services/oralExam';
const voice=vi.hoisted(()=>({state:'idle',error:'',mic:false,muted:false,question:'',checkMic:vi.fn(),connect:vi.fn(),stop:vi.fn(),toggleMute:vi.fn()}));
vi.mock('../hooks/useOralExamVoice',()=>({useOralExamVoice:()=>voice}));
vi.mock('../services/oralExam',()=>({oralExamService:{status:vi.fn(),materials:vi.fn(),sessions:vi.fn(),get:vi.fn(),create:vi.fn(),start:vi.fn(),end:vi.fn(),evaluate:vi.fn(),extract:vi.fn()}}));
const session={id:'exam-1',material_title:'Computer networks',language:'en',status:'ready',turns:[],evaluation_status:'pending'};
beforeEach(()=>{
  vi.resetAllMocks();Object.assign(voice,{state:'idle',error:'',mic:false,muted:false,question:''});
  api.status.mockResolvedValue({data:{enabled:true}});api.materials.mockResolvedValue({data:{materials:[{kind:'lecture',id:'lecture-1',title:'Computer networks'}]}});api.sessions.mockResolvedValue({data:{sessions:[]}});
  api.create.mockResolvedValue({data:{session}});api.get.mockResolvedValue({data:{session}});voice.checkMic.mockResolvedValue(true);
});
const open=(path='/dashboard/oral-exam')=>render(<MemoryRouter initialEntries={[path]}><OralExamPage/></MemoryRouter>);
const pick=(input,file)=>fireEvent.change(input,{target:{files:[file]}});
it('uploads a document, shows what was extracted and prepares the exam from that text',async()=>{
  const text=('# Routing\n\n'+'Routers forward packets between networks using routing tables. '.repeat(3)).trim();
  api.extract.mockImplementation(async(_file,{onUploadProgress})=>{onUploadProgress({loaded:50,total:100});onUploadProgress({loaded:100,total:100});
    return {data:{material:{title:'Week 3 routing',text,format:'pdf',format_label:'PDF',file_name:'Week 3 routing.pdf',file_size:20480,characters:text.length,units:{kind:'page',count:4},truncation:null}}};});
  open();pick(await screen.findByLabelText('Upload study material'),new File(['%PDF'],'Week 3 routing.pdf',{type:'application/pdf'}));
  expect(await screen.findByText(/Extracted \d+ characters/)).toBeInTheDocument();
  expect(screen.getByText('Week 3 routing.pdf')).toBeInTheDocument();expect(screen.getByText(/PDF · 4 pages/)).toBeInTheDocument();
  expect(screen.getByLabelText(/the exam uses exactly this text/)).toHaveValue(text);
  expect(screen.getByLabelText('Material title')).toHaveValue('Week 3 routing');
  fireEvent.click(screen.getByRole('button',{name:/Prepare exam/}));
  await waitFor(()=>expect(api.create).toHaveBeenCalledWith({source:{kind:'text',title:'Week 3 routing',text},language:'en'},expect.any(String)));
});
it('explains truncated material and lets the student remove the file',async()=>{
  const text='Routers forward packets between networks using routing tables. '.repeat(20).trim();
  api.extract.mockResolvedValue({data:{material:{title:'Textbook',text,format:'pdf',format_label:'PDF',file_name:'textbook.pdf',file_size:3000000,characters:text.length,units:{kind:'page',count:180},truncation:{kept_characters:text.length,original_characters:250000,kept_units:{kind:'page',from:1,to:64,of:180}}}}});
  open();pick(await screen.findByLabelText('Upload study material'),new File(['%PDF'],'textbook.pdf',{type:'application/pdf'}));
  expect(await screen.findByText(/Only pages 1–64 of 180 are included/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Remove textbook.pdf'}));
  expect(screen.getByLabelText(/Or paste your study material/)).toHaveValue('');
  expect(screen.getByLabelText('Upload study material')).toBeInTheDocument();
});
it('shows the server explanation for an unsupported file and keeps pasted text',async()=>{
  api.extract.mockRejectedValue({response:{status:415,data:{error:'Images and photos of notes are not supported yet because EduFusion cannot read text from images (OCR).'}}});
  open();const pasted='Routers forward packets between networks using routing tables. '.repeat(3);
  fireEvent.change(await screen.findByLabelText(/Or paste your study material/),{target:{value:pasted}});
  pick(screen.getByLabelText('Upload study material'),new File(['png'],'board.png',{type:'image/png'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('OCR');
  fireEvent.click(screen.getByRole('button',{name:'Remove board.png'}));
  expect(screen.getByLabelText(/Or paste your study material/)).toHaveValue(pasted);expect(api.create).not.toHaveBeenCalled();
});
it('rejects files over 4 MB before uploading',async()=>{
  open();const big=new File(['x'],'huge.pdf',{type:'application/pdf'});Object.defineProperty(big,'size',{value:5*1024*1024});
  pick(await screen.findByLabelText('Upload study material'),big);
  expect(await screen.findByRole('alert')).toHaveTextContent('limit is 4 MB');expect(api.extract).not.toHaveBeenCalled();
});
it('keeps the paste-text flow working',async()=>{
  open();const pasted='Packets travel through routers across connected networks. '.repeat(3).trim();
  fireEvent.change(await screen.findByLabelText(/Or paste your study material/),{target:{value:pasted}});
  fireEvent.click(screen.getByRole('button',{name:/Prepare exam/}));
  await waitFor(()=>expect(api.create).toHaveBeenCalledWith({source:{kind:'text',title:'My study material',text:pasted},language:'en'},expect.any(String)));
});
