import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import DashboardLayout from './components/layout/DashboardLayout';
import Landing from './pages/Landing';
import Auth from './pages/Auth';
import DashboardHome from './pages/DashboardHome';
import ChatbotPage from './pages/ChatbotPage';
import { AcademicClockPage, AtRiskStudentsPage, ChatbotFilesPage } from './pages/AdminPages';
import { AIToolPage, QuestionGeneratorPage } from './pages/Placeholders';
import StudentPredictionPage from './pages/StudentPredictionPage';
import LectureScribePage from './pages/LectureScribePage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
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
            <Route path="my-prediction" element={<StudentPredictionPage />} />
            <Route path="admin/at-risk" element={<AtRiskStudentsPage />} />
            <Route path="admin/clock" element={<AcademicClockPage />} />
            <Route path="admin/chatbot-files" element={<ChatbotFilesPage />} />
            <Route path="ai-tool" element={<AIToolPage />} />
            <Route path="question-gen" element={<QuestionGeneratorPage />} />
            <Route path="youtube" element={<LectureScribePage />} />
          </Route>

          {/* Unknown paths land on the public home rather than a hard 404 */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#FFFFFF',
            color: '#222831',
            border: '1px solid rgba(118,171,174,0.35)',
            fontFamily: 'DM Sans, sans-serif',
            fontSize: '14px',
          },
          success: { iconTheme: { primary: '#76ABAE', secondary: '#FFFFFF' } },
          error: { iconTheme: { primary: '#ef4444', secondary: '#FFFFFF' } },
        }}
      />
    </AuthProvider>
  );
}
