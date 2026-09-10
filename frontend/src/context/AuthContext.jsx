import { createContext, useContext, useState, useEffect } from 'react';
import api, { authService, clearSession } from '../services/api';

const AuthContext = createContext(null);

const readStoredUser = () => {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};

const persistSession = (token, user) => {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
};

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // On every page load (including a hard refresh on a deep link) the stored
  // token is verified against the API before the dashboard renders. Without
  // this, an expired 24h token would render the shell and then have every
  // request fail with a 401.
  useEffect(() => {
    let cancelled = false;

    const bootstrap = async () => {
      const token = localStorage.getItem('token');
      const stored = readStoredUser();

      if (!token) {
        clearSession();
        if (!cancelled) setLoading(false);
        return;
      }

      api.defaults.headers.common['Authorization'] = `Bearer ${token}`;
      if (stored && !cancelled) setUser(stored);

      try {
        const { data } = await authService.me();
        if (cancelled) return;
        // `/auth/me` is the source of truth for id/role; keep locally cached
        // extras (e.g. student_name) that the token payload does not carry.
        const merged = { ...(stored || {}), ...(data.user || {}) };
        localStorage.setItem('user', JSON.stringify(merged));
        setUser(merged);
      } catch (err) {
        if (cancelled) return;
        if (err.response?.status === 401) {
          clearSession();
          setUser(null);
        }
        // A network/500 error means the API is unreachable, not that the
        // session is invalid — keep the cached user rather than signing out.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    bootstrap();
    return () => { cancelled = true; };
  }, []);

  const login = async (username, password) => {
    const { data } = await api.post(
      '/auth/login',
      { username, password },
      { skipAuthRedirect: true }
    );
    persistSession(data.token, data.user);
    setUser(data.user);
    return data;
  };

  const registerStudent = async (payload) => {
    const { data } = await api.post('/auth/register-student', payload, { skipAuthRedirect: true });
    persistSession(data.token, data.user);
    setUser(data.user);
    return data;
  };

  const logout = () => {
    clearSession();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, registerStudent, logout, loading, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
