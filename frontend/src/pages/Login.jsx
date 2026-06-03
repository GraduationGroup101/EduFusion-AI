import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { Eye, EyeOff, Brain, Lock, User, UserPlus } from 'lucide-react';
import api from '../services/api';

const defaults = {
  id_student: '',
  pin: '',
  student_name: '',
  email: '',
  course_presentation_id: '',
  gender: 'M',
  disability: 'N',
  age_band: '0-35',
  highest_education: 'A Level or Equivalent',
  imd_band: '50-60%',
  region: 'Unknown',
  num_of_prev_attempts: 0,
  studied_credits: 60,
  date_registration: 0,
};

const educationOptions = [
  'No Formal quals',
  'Lower Than A Level',
  'A Level or Equivalent',
  'HE Qualification',
  'Post Graduate Qualification',
];

const imdOptions = [
  '0-10%',
  '10-20%',
  '20-30%',
  '30-40%',
  '40-50%',
  '50-60%',
  '60-70%',
  '70-80%',
  '80-90%',
  '90-100%',
];

export default function Login() {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ username: '', password: '' });
  const [registerForm, setRegisterForm] = useState(defaults);
  const [courses, setCourses] = useState([]);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login, registerStudent } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (mode !== 'register' || courses.length > 0) return;
    api.get('/auth/registration-courses')
      .then(({ data }) => {
        const rows = data.courses || [];
        setCourses(rows);
        if (rows[0]) {
          setRegisterForm((prev) => ({ ...prev, course_presentation_id: rows[0].id }));
        }
      })
      .catch(() => toast.error('Failed to load courses'));
  }, [mode, courses.length]);

  const handleLogin = async (event) => {
    event.preventDefault();
    if (!form.username || !form.password) {
      toast.error('Please fill in all fields');
      return;
    }
    setLoading(true);
    try {
      await login(form.username, form.password);
      toast.success('Welcome back!');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    setLoading(true);
    try {
      const data = await registerStudent(registerForm);
      (data.warnings || []).forEach((message) => toast(message));
      toast.success('Student registered successfully');
      navigate('/dashboard');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const updateRegister = (key, value) => {
    setRegisterForm((prev) => ({ ...prev, [key]: value }));
  };

  const inputClass = 'w-full bg-surface/50 border border-border rounded-xl px-4 py-3 text-light-accent placeholder-light-accent/20 focus:outline-none focus:border-accent transition-colors text-sm';

  return (
    <div className="min-h-screen bg-primary grid-pattern flex items-center justify-center p-4 relative overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className={mode === 'register' ? 'w-full max-w-4xl' : 'w-full max-w-md'}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="text-center mb-8"
        >
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4 animate-pulse-glow"
               style={{ background: '#76ABAE' }}>
            <Brain className="w-8 h-8 text-white" />
          </div>
          <h1 className="font-display text-3xl font-bold text-gradient">EduPredict AI</h1>
          <p className="text-light-accent/50 mt-2 text-sm font-mono tracking-widest uppercase">
            Intelligent Academic Platform
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="glass rounded-2xl p-8 glow-border"
        >
          <div className="flex items-center justify-between gap-3 mb-6">
            <div>
              <h2 className="font-display text-xl font-semibold text-light-accent">
                {mode === 'login' ? 'Sign In' : 'Student Register'}
              </h2>
              <p className="text-light-accent/40 text-sm">
                {mode === 'login' ? 'Access your AI dashboard' : 'Create a new student profile for prediction'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setMode((prev) => prev === 'login' ? 'register' : 'login')}
              className="rounded-xl border border-border px-3 py-2 text-sm text-light-accent hover:bg-secondary/10"
            >
              {mode === 'login' ? 'Register' : 'Sign In'}
            </button>
          </div>

          {mode === 'login' ? (
            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label className="block text-xs font-mono text-accent uppercase tracking-wider mb-2">
                  Student ID or Username
                </label>
                <div className="relative">
                  <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-accent/60" />
                  <input
                    type="text"
                    value={form.username}
                    onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
                    className="w-full bg-surface/50 border border-border rounded-xl pl-10 pr-4 py-3 text-light-accent placeholder-light-accent/20 focus:outline-none focus:border-accent transition-colors text-sm"
                    placeholder="Enter your student ID or username"
                    autoComplete="username"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-mono text-accent uppercase tracking-wider mb-2">
                  PIN / Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-accent/60" />
                  <input
                    type={showPass ? 'text' : 'password'}
                    value={form.password}
                    onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
                    className="w-full bg-surface/50 border border-border rounded-xl pl-10 pr-11 py-3 text-light-accent placeholder-light-accent/20 focus:outline-none focus:border-accent transition-colors text-sm"
                    placeholder="Enter your PIN or password"
                    autoComplete="current-password"
                  />
                  <button type="button" onClick={() => setShowPass((prev) => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-accent/50 hover:text-accent transition-colors">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 rounded-xl font-display font-semibold text-sm tracking-wide transition-all duration-200"
                style={{ background: loading ? 'rgba(118,171,174,0.55)' : '#76ABAE' }}
              >
                <span className="text-white">{loading ? 'Authenticating...' : 'Sign In'}</span>
              </button>
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="space-y-2">
                  <span className="text-xs font-mono text-accent uppercase">Student ID</span>
                  <input required type="number" className={inputClass} value={registerForm.id_student} onChange={(event) => updateRegister('id_student', event.target.value)} />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-mono text-accent uppercase">PIN</span>
                  <input required type="password" minLength={4} className={inputClass} value={registerForm.pin} onChange={(event) => updateRegister('pin', event.target.value)} />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-mono text-accent uppercase">Student Name</span>
                  <input required className={inputClass} value={registerForm.student_name} onChange={(event) => updateRegister('student_name', event.target.value)} />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-mono text-accent uppercase">Email</span>
                  <input type="email" className={inputClass} value={registerForm.email} onChange={(event) => updateRegister('email', event.target.value)} />
                </label>
                <label className="space-y-2 md:col-span-2">
                  <span className="text-xs font-mono text-accent uppercase">Course</span>
                  <select required className={inputClass} value={registerForm.course_presentation_id} onChange={(event) => updateRegister('course_presentation_id', event.target.value)}>
                    {courses.map((course) => (
                      <option key={course.id} value={course.id}>
                        {course.code_module} / {course.code_presentation} - day {course.current_day}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <label className="space-y-2">
                  <span className="text-xs font-mono text-accent uppercase">Gender</span>
                  <select className={inputClass} value={registerForm.gender} onChange={(event) => updateRegister('gender', event.target.value)}>
                    <option value="M">Male</option>
                    <option value="F">Female</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-mono text-accent uppercase">Disability</span>
                  <select className={inputClass} value={registerForm.disability} onChange={(event) => updateRegister('disability', event.target.value)}>
                    <option value="N">No</option>
                    <option value="Y">Yes</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-mono text-accent uppercase">Age Band</span>
                  <select className={inputClass} value={registerForm.age_band} onChange={(event) => updateRegister('age_band', event.target.value)}>
                    <option value="0-35">0-35</option>
                    <option value="35-55">35-55</option>
                    <option value="55<=">55&lt;=</option>
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-mono text-accent uppercase">Education</span>
                  <select className={inputClass} value={registerForm.highest_education} onChange={(event) => updateRegister('highest_education', event.target.value)}>
                    {educationOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-mono text-accent uppercase">IMD Band</span>
                  <select className={inputClass} value={registerForm.imd_band} onChange={(event) => updateRegister('imd_band', event.target.value)}>
                    {imdOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-mono text-accent uppercase">Previous Attempts</span>
                  <input type="number" min="0" className={inputClass} value={registerForm.num_of_prev_attempts} onChange={(event) => updateRegister('num_of_prev_attempts', event.target.value)} />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-mono text-accent uppercase">Studied Credits</span>
                  <input type="number" min="1" className={inputClass} value={registerForm.studied_credits} onChange={(event) => updateRegister('studied_credits', event.target.value)} />
                </label>
                <label className="space-y-2">
                  <span className="text-xs font-mono text-accent uppercase">Registration Day</span>
                  <input type="number" className={inputClass} value={registerForm.date_registration} onChange={(event) => updateRegister('date_registration', event.target.value)} />
                </label>
              </div>

              <button
                type="submit"
                disabled={loading || courses.length === 0}
                className="w-full py-3 rounded-xl font-display font-semibold text-sm tracking-wide transition-all duration-200 disabled:opacity-60"
                style={{ background: loading ? 'rgba(118,171,174,0.55)' : '#76ABAE' }}
              >
                <span className="text-white flex items-center justify-center gap-2">
                  <UserPlus className="w-4 h-4" />
                  {loading ? 'Creating account...' : 'Register and Enter'}
                </span>
              </button>
            </form>
          )}
        </motion.div>
      </motion.div>
    </div>
  );
}
