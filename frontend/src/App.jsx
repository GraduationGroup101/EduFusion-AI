import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import DashboardLayout from './components/layout/DashboardLayout';
import BrandedLoader from './components/ui/BrandedLoader';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import { lazy, Suspense } from 'react';
const DashboardHome = lazy(() => import('./pages/DashboardHome'));
const ChatbotPage = lazy(() => import('./pages/ChatbotPage'));
const StudentPredictionPage = lazy(() => import('./pages/StudentPredictionPage'));
const LectureScribePage = lazy(() => import('./pages/LectureScribePage'));
const OralExamPage = lazy(() => import('./pages/OralExamPage'));
const namedPage = (loader, name) => lazy(() => loader().then((module) => ({ default: module[name] })));
const AcademicClockPage = namedPage(() => import('./pages/AdminPages'), 'AcademicClockPage');
const AtRiskStudentsPage = namedPage(() => import('./pages/AdminPages'), 'AtRiskStudentsPage');
const ChatbotFilesPage = namedPage(() => import('./pages/AdminPages'), 'ChatbotFilesPage');
const AIToolPage = namedPage(() => import('./pages/Placeholders'), 'AIToolPage');
const QuestionGeneratorPage = namedPage(() => import('./pages/Placeholders'), 'QuestionGeneratorPage');
const adminPage = (page) => <ProtectedRoute allowedRoles={['admin','advisor']}>{page}</ProtectedRoute>;

// LectureScribe used to live at /dashboard/youtube. Old bookmarks and Oral Exam
// deep links (?job=&tool=) keep their query and hash on the way to the new path.
export function LegacyLectureScribeRedirect() {
  const { search, hash } = useLocation();
  return <Navigate replace to={{ pathname: '/dashboard/lecturescribe', search, hash }} />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        {/* Public and shell chunks: a full-screen branded loader. Pages inside the
            workspace have their own Suspense in DashboardLayout so the shell stays. */}
        <Suspense fallback={<BrandedLoader variant="screen" label="Loading EduFusion" />}>
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
            <Route path="lecturescribe" element={<LectureScribePage />} />
            <Route path="youtube/*" element={<LegacyLectureScribeRedirect />} />
            <Route path="oral-exam" element={<OralExamPage />} />
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
