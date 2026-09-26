import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import DashboardLayout from './components/layout/DashboardLayout';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import { lazy, Suspense } from 'react';
const DashboardHome = lazy(() => import('./pages/DashboardHome'));
const ChatbotPage = lazy(() => import('./pages/ChatbotPage'));
const StudentPredictionPage = lazy(() => import('./pages/StudentPredictionPage'));
const LectureScribePage = lazy(() => import('./pages/LectureScribePage'));
const namedPage = (loader, name) => lazy(() => loader().then((module) => ({ default: module[name] })));
const AcademicClockPage = namedPage(() => import('./pages/AdminPages'), 'AcademicClockPage');
const AtRiskStudentsPage = namedPage(() => import('./pages/AdminPages'), 'AtRiskStudentsPage');
const ChatbotFilesPage = namedPage(() => import('./pages/AdminPages'), 'ChatbotFilesPage');
const AIToolPage = namedPage(() => import('./pages/Placeholders'), 'AIToolPage');
const QuestionGeneratorPage = namedPage(() => import('./pages/Placeholders'), 'QuestionGeneratorPage');
const adminPage = (page) => <ProtectedRoute allowedRoles={['admin','advisor']}>{page}</ProtectedRoute>;

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<div role="status" className="p-8 text-light-accent">Loading page…</div>}>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Landing />} />
          <Route path="/login" element={<Auth mode="login" />} />
          <Route path="/register" element={<Auth mode="register" />} />

          {/* Protected */}
          <Route path="/dashboard" element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }>
            <Route index element={<DashboardHome />} />
            <Route path="chatbot" element={<ChatbotPage />} />
            <Route path="my-prediction" element={<ProtectedRoute allowedRoles={['student']}><StudentPredictionPage /></ProtectedRoute>} />
            <Route path="admin/at-risk" element={adminPage(<AtRiskStudentsPage />)} />
            <Route path="admin/clock" element={adminPage(<AcademicClockPage />)} />
            <Route path="admin/chatbot-files" element={adminPage(<ChatbotFilesPage />)} />
            <Route path="ai-tool" element={adminPage(<AIToolPage />)} />
            <Route path="question-gen" element={<QuestionGeneratorPage />} />
            <Route path="youtube" element={<LectureScribePage />} />
          </Route>

          {/* Unknown paths land on the public home rather than a hard 404 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#FFFFFF',
            color: '#193C37',
            border: '1px solid rgba(8,127,117,0.35)',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: '#087F75', secondary: '#FFFFFF' } },
          error: { iconTheme: { primary: '#ef4444', secondary: '#FFFFFF' } },
        }}
      />
    </AuthProvider>
  );
}
