import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import BrandedLoader from '../ui/BrandedLoader';

export default function ProtectedRoute({ children, allowedRoles }) {
  const { isAuthenticated, loading, user } = useAuth();
  const location = useLocation();

  // While the stored session is verified, show the current brand rather than
  // a placeholder icon, so there is no flash of an old identity.
  if (loading) return <BrandedLoader variant="screen" label="Checking your session" />;

  if (isAuthenticated && allowedRoles && !allowedRoles.includes(user?.role)) return <Navigate to="/dashboard" replace />;

  // Remember where they were headed so a refresh on a deep link returns there
  // after signing in, instead of always dumping them on the dashboard index.
  return isAuthenticated
    ? children
    : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
}
