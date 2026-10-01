import Brand from '../Brand';
import { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Mic, MessageSquare, FileQuestion, Youtube, LayoutDashboard, LogOut, ChevronLeft, ChevronRight, TrendingUp, User, AlertTriangle, Clock, X } from 'lucide-react';
import toast from 'react-hot-toast';

const overview = { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', exact: true };
const learning = [
  { path: '/dashboard/oral-exam', icon: Mic, label: 'Oral Exam' },
  { path: '/dashboard/chatbot', icon: MessageSquare, label: 'Academic Chatbot' },
  { path: '/dashboard/question-gen', icon: FileQuestion, label: 'Quiz Generator' },
  { path: '/dashboard/lecturescribe', icon: Youtube, label: 'LectureScribe' },
];
const insights = [
  { path: '/dashboard/admin/at-risk', icon: AlertTriangle, label: 'At-Risk Students' },
  { path: '/dashboard/admin/clock', icon: Clock, label: 'Academic Clock' },
  { path: '/dashboard/admin/chatbot-files', icon: MessageSquare, label: 'Academic Chatbot' },
];

export default function Sidebar({ mobileOpen = false, onMobileClose, menuRef }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const asideRef = useRef(null);
  const closeRef = useRef(onMobileClose);
  closeRef.current = onMobileClose;
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const compact = collapsed && !isMobile;
  const groups = [
    { title: 'Overview', items: [overview] },
    ...(user?.role === 'student' ? [] : [{ title: 'Academic insights', items: insights }]),
    { title: 'Learning tools', items: [
      { path: user?.role === 'student' ? '/dashboard/my-prediction' : '/dashboard/ai-tool', icon: TrendingUp, label: 'EduPredict' },
      ...learning.filter(item=>user?.role==='student'||item.path!=='/dashboard/chatbot'),
    ] },
  ];

  useEffect(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const update = () => { setIsMobile(query.matches); if (!query.matches) closeRef.current(); };
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!mobileOpen || !isMobile) return;
    const drawer = asideRef.current;
    const previous = menuRef?.current;
    const focusFirst = () => drawer.querySelector('button')?.focus();
    const frame = requestAnimationFrame(focusFirst);
    const keepFocus = event => { if (!drawer.contains(event.target)) focusFirst(); };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); }
      if (event.key !== 'Tab') return;
      const items = [...drawer.querySelectorAll('a[href], button:not([disabled])')].filter(el => el.getClientRects().length);
      const first = items[0], last = items[items.length - 1];
      if (!drawer.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', keepFocus);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', keepFocus);
      previous?.focus();
    };
  }, [mobileOpen, isMobile, menuRef]);

  const handleLogout = () => {
    logout(); toast.success('Signed out successfully'); onMobileClose(); navigate('/login');
  };

  return <aside id="workspace-navigation" ref={asideRef}
    className={`workspace-sidebar ${compact ? 'is-collapsed' : ''} ${mobileOpen ? 'is-open' : ''}`}
    role={isMobile && mobileOpen ? 'dialog' : undefined}
    aria-modal={isMobile && mobileOpen ? true : undefined}
    aria-label="Workspace navigation" inert={isMobile && !mobileOpen ? '' : undefined}>
    <div className="sidebar-brand">
      <Brand compact={compact} />
      <button type="button" onClick={onMobileClose} className="icon-button md:hidden" aria-label="Close navigation"><X size={20} /></button>
    </div>
    <nav aria-label="Main navigation" className="sidebar-links">
      {groups.map(group => <div key={group.title} className="nav-group">
        {!compact && <p className="nav-section">{group.title}</p>}
        {group.items.map(({ path, icon: Icon, label, exact }) => <NavLink key={path} to={path} title={label} aria-label={compact ? label : undefined} end={exact} onClick={onMobileClose}
          className={({isActive}) => `sidebar-link ${isActive ? 'sidebar-item-active' : ''}`}>
          <Icon size={19} aria-hidden="true" />{!compact && <span>{label}</span>}
        </NavLink>)}
      </div>)}
    </nav>
    <div className="sidebar-account">
      <div className="account-identity"><span className="account-avatar"><User size={17}/></span>
        {!compact && <div className="min-w-0"><p className="truncate font-semibold">{user?.student_name || user?.username}</p><p className="truncate text-xs text-muted"><span className="capitalize">{user?.role}</span>{user?.student_name ? ` · ${user.username}` : ''}</p></div>}
      </div>
      <div className="account-actions">
        <button onClick={handleLogout} className="sidebar-link" aria-label="Sign out" title="Sign out"><LogOut size={17}/>{!compact && <span>Sign out</span>}</button>
        <button onClick={() => setCollapsed(value => !value)} className="icon-button hidden md:inline-flex" aria-label={compact ? 'Expand navigation' : 'Collapse navigation'} title={compact ? 'Expand navigation' : 'Collapse navigation'}>
          {compact ? <ChevronRight size={18}/> : <ChevronLeft size={18}/>}
        </button>
      </div>
    </div>
  </aside>;
}
