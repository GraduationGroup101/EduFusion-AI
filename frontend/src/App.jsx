import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/auth/ProtectedRoute';
import DashboardLayout from './components/layout/DashboardLayout';
import Login from './pages/Login';
import DashboardHome from './pages/DashboardHome';
import ChatbotPage from './pages/ChatbotPage';
import { AcademicClockPage, AtRiskStudentsPage } from './pages/AdminPages';
import { AIToolPage, QuestionGeneratorPage, YouTubeExtractorPage } from './pages/Placeholders';
import StudentPredictionPage from './pages/StudentPredictionPage';

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
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
            <Route path="ai-tool" element={<AIToolPage />} />
            <Route path="question-gen" element={<QuestionGeneratorPage />} />
            <Route path="youtube" element={<YouTubeExtractorPage />} />
          </Route>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
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
