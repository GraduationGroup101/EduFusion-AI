import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../../context/AuthContext';
import {
  Brain, MessageSquare, FileQuestion, Youtube,
  LayoutDashboard, LogOut, ChevronLeft, ChevronRight,
  Sparkles, User, AlertTriangle, Clock
} from 'lucide-react';
import toast from 'react-hot-toast';

const studentNavItems = [
  { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { path: '/dashboard/chatbot', icon: MessageSquare, label: 'AI Chatbot' },
];

const adminNavItems = [
  { path: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', exact: true },
  { path: '/dashboard/admin/at-risk', icon: AlertTriangle, label: 'At-Risk Students' },
  { path: '/dashboard/admin/clock', icon: Clock, label: 'Academic Clock' },
  { path: '/dashboard/chatbot', icon: MessageSquare, label: 'AI Chatbot' },
  { path: '/dashboard/ai-tool', icon: Sparkles, label: 'AI Tool' },
  { path: '/dashboard/question-gen', icon: FileQuestion, label: 'Question Generator' },
  { path: '/dashboard/youtube', icon: Youtube, label: 'YouTube Extractor' },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const navItems = user?.role === 'student' ? studentNavItems : adminNavItems;

  const handleLogout = () => {
    logout();
    toast.success('Signed out successfully');
    navigate('/login');
  };

  return (
    <motion.aside
      animate={{ width: collapsed ? 72 : 240 }}
      transition={{ duration: 0.3, ease: 'easeInOut' }}
      className="flex flex-col h-screen sticky top-0 flex-shrink-0"
      style={{ background: '#FFFFFF', borderRight: '1px solid rgba(118,171,174,0.26)' }}
    >
      {/* Logo */}
      <div className="flex items-center gap-3 p-4 mb-2">
        <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center animate-pulse-glow"
             style={{ background: '#76ABAE' }}>
          <Brain className="w-5 h-5 text-white" />
        </div>
        <AnimatePresence>
          {!collapsed && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <span className="font-display font-bold text-light-accent text-sm">EduPredict</span>
              <span className="block text-accent/60 text-xs font-mono">AI Platform</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 space-y-1">
        {navItems.map(({ path, icon: Icon, label, exact }) => (
          <NavLink
            key={path}
            to={path}
            end={exact}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 group relative overflow-hidden
               ${isActive ? 'sidebar-item-active text-light-accent' : 'text-light-accent/55 hover:text-light-accent hover:bg-secondary/10'}`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`w-5 h-5 flex-shrink-0 ${isActive ? 'text-accent' : 'text-current'}`} />
                <AnimatePresence>
                  {!collapsed && (
                    <motion.span
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="text-sm font-medium truncate"
                    >
                      {label}
                    </motion.span>
                  )}
                </AnimatePresence>
                {collapsed && (
                  <div className="absolute left-full ml-2 px-2 py-1 bg-surface-2 border border-border rounded-lg text-xs text-light-accent whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-50">
                    {label}
                  </div>
                )}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User & Collapse */}
      <div className="p-2 space-y-1 border-t border-border/50 mt-2">
        <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${collapsed ? 'justify-center' : ''}`}>
          <div className="w-8 h-8 rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-bold text-white"
               style={{ background: '#76ABAE' }}>
            <User className="w-4 h-4" />
          </div>
          <AnimatePresence>
            {!collapsed && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="overflow-hidden">
                <p className="text-light-accent text-xs font-medium truncate">{user?.username}</p>
                <p className="text-accent/60 text-xs font-mono capitalize">{user?.role}</p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <button onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-light-accent/40 hover:text-red-400 hover:bg-red-400/10 transition-all duration-200 text-sm">
          <LogOut className="w-4 h-4 flex-shrink-0" />
          <AnimatePresence>
            {!collapsed && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                Sign Out
              </motion.span>
            )}
          </AnimatePresence>
        </button>

        <button onClick={() => setCollapsed(p => !p)}
          className="flex items-center gap-3 w-full px-3 py-2 rounded-xl text-light-accent/45 hover:text-light-accent hover:bg-secondary/10 transition-all duration-200 text-sm">
          {collapsed
            ? <ChevronRight className="w-4 h-4 flex-shrink-0" />
            : <><ChevronLeft className="w-4 h-4 flex-shrink-0" /><span className="text-xs">Collapse</span></>
          }
        </button>
      </div>
    </motion.aside>
  );
}
