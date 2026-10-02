import {render,screen} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {beforeEach,expect,it,vi} from 'vitest';
import {ChatbotFilesPage} from '../pages/AdminPages';
import Sidebar from '../components/layout/Sidebar';
vi.mock('../context/AuthContext',()=>({useAuth:()=>({user:{role:'admin',username:'Admin'},logout:vi.fn()})}));
vi.mock('../pages/ChatbotPage',()=>({default:()=> <h1>Existing academic chat interface</h1>}));
beforeEach(()=>vi.stubGlobal('matchMedia',vi.fn(()=>({matches:false,addEventListener:vi.fn(),removeEventListener:vi.fn()}))));
it('renders the existing chat inside its administrative section and retains knowledge management access',async()=>{
  render(<ChatbotFilesPage/>);
  await screen.findByRole('heading',{name:'Existing academic chat interface'});
  expect(screen.getByRole('link',{name:'Manage knowledge base'})).toHaveAttribute('href','https://final-iug-chat-botv3.onrender.com/app/admin.html');
  expect(screen.queryByText('Chatbot administration moved')).not.toBeInTheDocument();
});
it('places one academic chatbot link in the administrative navigation',()=>{
  render(<MemoryRouter><Sidebar onMobileClose={()=>{}}/></MemoryRouter>);
  const links=screen.getAllByRole('link',{name:'Academic Chatbot'});
  expect(links).toHaveLength(1);
  expect(links[0]).toHaveAttribute('href','/dashboard/admin/chatbot-files');
});
