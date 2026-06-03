import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Brain } from 'lucide-react';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-primary flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-2xl flex items-center justify-center animate-pulse-glow"
               style={{ background: '#76ABAE' }}>
            <Brain className="w-6 h-6 text-white" />
          </div>
          <div className="flex gap-1">
            {[0,1,2].map(i => (
              <span key={i} className="w-2 h-2 rounded-full bg-accent"
                    style={{ animation: `blink 1s ${i * 0.2}s infinite` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
}
