import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import {
  Eye, EyeOff, Brain, Lock, User, ArrowRight, ArrowLeft,
  Check, Building2, Info, MessageSquare, Youtube, FileQuestion, TrendingUp,
} from 'lucide-react';
import { authService } from '../services/api';

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
  '0-10%', '10-20%', '20-30%', '30-40%', '40-50%',
  '50-60%', '60-70%', '70-80%', '80-90%', '90-100%',
];

const BRAND_POINTS = [
  { icon: TrendingUp, label: 'EduPredict', text: 'See your academic risk before the final grade does.' },
  { icon: Youtube, label: 'LectureScribe', text: 'Recorded lectures as clean, readable transcripts.' },
  { icon: MessageSquare, label: 'Academic Chatbot', text: 'University answers in plain language.' },
  { icon: FileQuestion, label: 'QuizForge', text: 'Practice questions from your own notes.' },
];

const inputClass =
  'w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-light-accent ' +
  'placeholder-light-accent/30 transition-colors focus:border-secondary focus:outline-none ' +
  'focus:ring-2 focus:ring-secondary/20';

/** A labelled field with an always-visible one-line explanation of what the value means. */
const Field = ({ label, hint, optional = false, children, className = '' }) => (
  <label className={`block ${className}`}>
    <span className="flex items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-light-accent/70">{label}</span>
      {optional && (
        <span className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-light-accent/45">
          Optional
        </span>
      )}
    </span>
    <span className="mt-2 block">{children}</span>
    {hint && <span className="mt-1.5 block text-xs leading-relaxed text-light-accent/45">{hint}</span>}
  </label>
);

const Stepper = ({ step }) => (
  <div className="mb-6 flex items-center gap-3">
    {[
      { n: 1, label: 'Your account' },
      { n: 2, label: 'Academic profile' },
    ].map((item, index) => {
      const done = step > item.n;
      const active = step === item.n;
      return (
        <div key={item.n} className="flex flex-1 items-center gap-3">
          <div className="flex items-center gap-2.5">
            <span
              className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold transition-colors ${
                done
                  ? 'bg-secondary text-white'
                  : active
                    ? 'bg-secondary/15 text-secondary ring-2 ring-secondary/35'
                    : 'bg-surface-2 text-light-accent/40'
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : item.n}
            </span>
            <span
              className={`hidden text-xs font-medium sm:block ${
                active || done ? 'text-light-accent' : 'text-light-accent/40'
              }`}
            >
              {item.label}
            </span>
          </div>
          {index === 0 && (
            <span className={`h-px flex-1 ${done ? 'bg-secondary' : 'bg-border'}`} />
          )}
        </div>
      );
    })}
  </div>
);

export default function Auth({ mode: initialMode = 'login' }) {
  const [mode, setMode] = useState(initialMode);
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({ username: '', password: '' });
  const [registerForm, setRegisterForm] = useState(defaults);
  const [courses, setCourses] = useState([]);
  const [coursesFailed, setCoursesFailed] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const { login, registerStudent, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const redirectTo = location.state?.from || '/dashboard';
  const expiredNotified = useRef(false);

  useEffect(() => {
    setMode(initialMode);
    setStep(1);
  }, [initialMode]);

  useEffect(() => {
    if (isAuthenticated) navigate(redirectTo, { replace: true });
  }, [isAuthenticated, navigate, redirectTo]);

  // The API layer redirects here with ?expired=1 when a stored token is rejected.
  useEffect(() => {
    if (searchParams.get('expired') && !expiredNotified.current) {
      expiredNotified.current = true;
      toast('Your session expired — please sign in again.', { icon: '🔒' });
    }
  }, [searchParams]);

  useEffect(() => {
    if (mode !== 'register' || courses.length > 0) return;
    authService.registrationCourses()
      .then(({ data }) => {
        const rows = data.courses || [];
        setCourses(rows);
        setCoursesFailed(rows.length === 0);
        if (rows[0]) {
          setRegisterForm((prev) => ({ ...prev, course_presentation_id: rows[0].id }));
        }
      })
      .catch(() => setCoursesFailed(true));
  }, [mode, courses.length]);

  const switchMode = (next) => {
    setMode(next);
    setStep(1);
    navigate(next === 'login' ? '/login' : '/register', { replace: true, state: location.state });
  };

  const handleLogin = async (event) => {
    event.preventDefault();
    if (!form.username.trim() || !form.password) {
      toast.error('Please fill in both fields');
      return;
    }
    setLoading(true);
    try {
      await login(form.username.trim(), form.password);
      toast.success('Welcome back!');
      navigate(redirectTo, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  const validateStepOne = () => {
    const { id_student, pin, student_name, email, course_presentation_id } = registerForm;
    if (!String(id_student).trim()) return 'Student ID is required';
    if (!/^\d+$/.test(String(id_student).trim())) return 'Student ID must be numbers only';
    if (String(pin).length < 4) return 'PIN must be at least 4 characters';
    if (!student_name.trim()) return 'Full name is required';
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) return 'That email address does not look valid';
    if (!course_presentation_id) return 'Please choose a course';
    return null;
  };

  const goToStepTwo = () => {
    const error = validateStepOne();
    if (error) {
      toast.error(error);
      return;
    }
    setStep(2);
  };

  const handleRegister = async (event) => {
    event.preventDefault();
    const error = validateStepOne();
    if (error) {
      toast.error(error);
      setStep(1);
      return;
    }
    setLoading(true);
    try {
      const payload = { ...registerForm, email: registerForm.email.trim() || null };
      const data = await registerStudent(payload);
      (data.warnings || []).forEach((message) => toast(message, { icon: 'ℹ️' }));
      toast.success('Account created — welcome to EduFusion AI');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  const updateRegister = (key, value) => setRegisterForm((prev) => ({ ...prev, [key]: value }));

  const submitDisabled = loading || (mode === 'register' && courses.length === 0);

  return (
    <div className="min-h-screen bg-primary lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      {/* ---------- Brand panel ---------- */}
      <aside
        className="relative hidden overflow-hidden px-12 py-14 lg:flex lg:flex-col"
        style={{ background: 'linear-gradient(160deg, #222831 0%, #2b3f42 60%, #3d5f60 100%)' }}
      >
        <div className="grid-pattern pointer-events-none absolute inset-0 opacity-[0.08]" aria-hidden="true" />

        <Link to="/" className="relative flex items-center gap-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: '#76ABAE' }}>
            <Brain className="h-5 w-5 text-white" />
          </span>
          <span className="font-display text-base font-bold text-white">EduFusion AI</span>
        </Link>

        <div className="relative my-auto max-w-md py-12">
          <h2 className="font-display text-3xl font-bold leading-tight text-white">
            Four AI tools for digital education, behind one account.
          </h2>

          <ul className="mt-9 space-y-5">
            {BRAND_POINTS.map((point) => (
              <li key={point.label} className="flex items-start gap-3.5">
                <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-white/10">
                  <point.icon className="h-4 w-4 text-white/85" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-white">{point.label}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-white/55">{point.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs leading-relaxed text-white/40">
          Graduation project · Computer Engineering Department · Islamic University of Gaza
        </p>
      </aside>

      {/* ---------- Form panel ---------- */}
      <main className="flex min-h-screen flex-col px-5 py-8 sm:px-8 lg:overflow-y-auto lg:py-12">
        <div className="flex items-center justify-between lg:hidden">
          <Link to="/" className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: '#76ABAE' }}>
              <Brain className="h-5 w-5 text-white" />
            </span>
            <span className="font-display text-base font-bold text-light-accent">EduFusion AI</span>
          </Link>
          <Link to="/" className="text-xs text-light-accent/50 hover:text-light-accent">
            ← Home
          </Link>
        </div>

        <div className={`mx-auto w-full py-10 ${mode === 'register' ? 'max-w-2xl' : 'max-w-md'} lg:my-auto`}>
          <div className="hidden justify-end lg:flex">
            <Link to="/" className="text-xs text-light-accent/45 transition-colors hover:text-light-accent">
              ← Back to home
            </Link>
          </div>

          {/* Mode switch */}
          <div className="mb-8 inline-flex rounded-xl border border-border bg-surface p-1">
            {[
              { key: 'login', label: 'Sign in' },
              { key: 'register', label: 'Create account' },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => switchMode(tab.key)}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                  mode === tab.key
                    ? 'bg-secondary text-white shadow-sm'
                    : 'text-light-accent/55 hover:text-light-accent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={mode}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }}
            >
              {mode === 'login' ? (
                /* ---------------- Sign in ---------------- */
                <form onSubmit={handleLogin} className="space-y-6">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-light-accent">Welcome back</h1>
                    <p className="mt-1.5 text-sm text-light-accent/55">
                      Sign in to reach your dashboard and tools.
                    </p>
                  </div>

                  <Field label="Student ID or username" hint="Students sign in with the ID they registered with. Staff use their assigned username.">
                    <span className="relative block">
                      <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-light-accent/35" />
                      <input
                        type="text"
                        value={form.username}
                        onChange={(e) => setForm((prev) => ({ ...prev, username: e.target.value }))}
                        className={`${inputClass} pl-10`}
                        placeholder="e.g. 120210627"
                        autoComplete="username"
                      />
                    </span>
                  </Field>

                  <Field label="PIN or password">
                    <span className="relative block">
                      <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-light-accent/35" />
                      <input
                        type={showPass ? 'text' : 'password'}
                        value={form.password}
                        onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                        className={`${inputClass} pl-10 pr-11`}
                        placeholder="Enter your PIN or password"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass((prev) => !prev)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-light-accent/40 transition-colors hover:text-light-accent"
                        aria-label={showPass ? 'Hide password' : 'Show password'}
                      >
                        {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </span>
                  </Field>

                  <button
                    type="submit"
                    disabled={loading}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
                    style={{ background: '#76ABAE' }}
                  >
                    {loading ? 'Signing in…' : 'Sign in'}
                    {!loading && <ArrowRight className="h-4 w-4" />}
                  </button>

                  <p className="text-center text-sm text-light-accent/50">
                    No account yet?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('register')}
                      className="font-semibold text-secondary hover:underline"
                    >
                      Create one
                    </button>
                  </p>

                  <div className="flex gap-3 rounded-xl border border-border bg-surface p-4">
                    <Building2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-secondary" />
                    <p className="text-xs leading-relaxed text-light-accent/55">
                      Accounts here are for the demo. Once the platform is connected to an
                      institution, you sign in with your existing university account instead.
                    </p>
                  </div>
                </form>
              ) : (
                /* ---------------- Register ---------------- */
                <form onSubmit={handleRegister} className="space-y-6">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-light-accent">
                      Create a demo student account
                    </h1>
                    <p className="mt-1.5 text-sm text-light-accent/55">
                      Two short steps. Only the account details are required — the rest give the
                      prediction model something to work with.
                    </p>
                  </div>

                  <Stepper step={step} />

                  {coursesFailed && (
                    <p className="rounded-xl border border-accent/25 bg-accent/5 p-4 text-xs leading-relaxed text-light-accent/65">
                      Courses could not be loaded, so registration is unavailable right now. The API
                      may still be waking up — please refresh in a moment.
                    </p>
                  )}

                  {step === 1 ? (
                    <motion.div
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25 }}
                      className="space-y-5"
                    >
                      <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Student ID" hint="Numbers only. This is also your username when you sign in.">
                          <input
                            type="text"
                            inputMode="numeric"
                            className={inputClass}
                            placeholder="e.g. 120210627"
                            value={registerForm.id_student}
                            onChange={(e) => updateRegister('id_student', e.target.value)}
                          />
                        </Field>

                        <Field label="PIN" hint="At least 4 characters. Used together with your ID to sign in.">
                          <span className="relative block">
                            <input
                              type={showPass ? 'text' : 'password'}
                              className={`${inputClass} pr-11`}
                              placeholder="••••"
                              value={registerForm.pin}
                              onChange={(e) => updateRegister('pin', e.target.value)}
                            />
                            <button
                              type="button"
                              onClick={() => setShowPass((prev) => !prev)}
                              className="absolute right-3 top-1/2 -translate-y-1/2 text-light-accent/40 transition-colors hover:text-light-accent"
                              aria-label={showPass ? 'Hide PIN' : 'Show PIN'}
                            >
                              {showPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </span>
                        </Field>

                        <Field label="Full name" hint="Shown on your dashboard.">
                          <input
                            className={inputClass}
                            placeholder="Your name"
                            value={registerForm.student_name}
                            onChange={(e) => updateRegister('student_name', e.target.value)}
                          />
                        </Field>

                        <Field
                          label="Email"
                          optional
                          hint="You can leave this empty. Nothing is sent to it — it is only kept for future notifications."
                        >
                          <input
                            type="email"
                            className={inputClass}
                            placeholder="Leave empty if you prefer"
                            value={registerForm.email}
                            onChange={(e) => updateRegister('email', e.target.value)}
                          />
                        </Field>

                        <Field
                          label="Course"
                          className="sm:col-span-2"
                          hint="The course you are enrolled in for this demo. The day shown is how far that course has progressed, which is what the model predicts against."
                        >
                          <select
                            className={inputClass}
                            value={registerForm.course_presentation_id}
                            onChange={(e) => updateRegister('course_presentation_id', e.target.value)}
                          >
                            {courses.length === 0 && <option value="">Loading courses…</option>}
                            {courses.map((course) => (
                              <option key={course.id} value={course.id}>
                                {course.code_module} / {course.code_presentation} — day {course.current_day}
                              </option>
                            ))}
                          </select>
                        </Field>
                      </div>

                      <button
                        type="button"
                        onClick={goToStepTwo}
                        disabled={submitDisabled}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
                        style={{ background: '#76ABAE' }}
                      >
                        Continue
                        <ArrowRight className="h-4 w-4" />
                      </button>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, x: 12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.25 }}
                      className="space-y-5"
                    >
                      <div className="flex gap-3 rounded-xl border border-secondary/25 bg-secondary/5 p-4">
                        <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-secondary" />
                        <p className="text-xs leading-relaxed text-light-accent/65">
                          These are the inputs EduPredict uses to estimate academic risk. They are
                          pre-filled with sensible demo values — adjust them or continue as they are.
                          In a real deployment they are read from the institution&apos;s student
                          records, not typed in here.
                        </p>
                      </div>

                      <div className="grid gap-5 sm:grid-cols-2">
                        <Field label="Gender" hint="Demographic field carried by the training dataset.">
                          <select
                            className={inputClass}
                            value={registerForm.gender}
                            onChange={(e) => updateRegister('gender', e.target.value)}
                          >
                            <option value="M">Male</option>
                            <option value="F">Female</option>
                          </select>
                        </Field>

                        <Field label="Age band" hint="Your age group at the time of enrolment.">
                          <select
                            className={inputClass}
                            value={registerForm.age_band}
                            onChange={(e) => updateRegister('age_band', e.target.value)}
                          >
                            <option value="0-35">Under 35</option>
                            <option value="35-55">35 to 55</option>
                            <option value="55<=">55 and above</option>
                          </select>
                        </Field>

                        <Field label="Registered disability" hint="Whether you receive disability support. It affects the risk estimate only as one signal among many.">
                          <select
                            className={inputClass}
                            value={registerForm.disability}
                            onChange={(e) => updateRegister('disability', e.target.value)}
                          >
                            <option value="N">No</option>
                            <option value="Y">Yes</option>
                          </select>
                        </Field>

                        <Field label="Highest education" hint="The highest qualification you held when starting the course.">
                          <select
                            className={inputClass}
                            value={registerForm.highest_education}
                            onChange={(e) => updateRegister('highest_education', e.target.value)}
                          >
                            {educationOptions.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </Field>

                        <Field label="IMD band" hint="Index of Multiple Deprivation — a socio-economic band from the OULAD dataset. Leave the default if it does not apply to you.">
                          <select
                            className={inputClass}
                            value={registerForm.imd_band}
                            onChange={(e) => updateRegister('imd_band', e.target.value)}
                          >
                            {imdOptions.map((option) => (
                              <option key={option} value={option}>{option}</option>
                            ))}
                          </select>
                        </Field>

                        <Field label="Previous attempts" hint="How many times you took this course before. 0 if this is your first.">
                          <input
                            type="number"
                            min="0"
                            className={inputClass}
                            value={registerForm.num_of_prev_attempts}
                            onChange={(e) => updateRegister('num_of_prev_attempts', e.target.value)}
                          />
                        </Field>

                        <Field label="Studied credits" hint="Total credits you are taking this term. A heavier load raises predicted risk.">
                          <input
                            type="number"
                            min="1"
                            className={inputClass}
                            value={registerForm.studied_credits}
                            onChange={(e) => updateRegister('studied_credits', e.target.value)}
                          />
                        </Field>

                        <Field label="Registration day" hint="When you registered, counted in days from the course start. Negative means you registered early.">
                          <input
                            type="number"
                            className={inputClass}
                            value={registerForm.date_registration}
                            onChange={(e) => updateRegister('date_registration', e.target.value)}
                          />
                        </Field>
                      </div>

                      <div className="flex flex-col gap-3 sm:flex-row">
                        <button
                          type="button"
                          onClick={() => setStep(1)}
                          className="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-5 py-3 text-sm font-semibold text-light-accent transition-colors hover:border-secondary/50"
                        >
                          <ArrowLeft className="h-4 w-4" />
                          Back
                        </button>
                        <button
                          type="submit"
                          disabled={submitDisabled}
                          className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white transition-transform hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-60"
                          style={{ background: '#76ABAE' }}
                        >
                          {loading ? 'Creating account…' : 'Create account'}
                          {!loading && <ArrowRight className="h-4 w-4" />}
                        </button>
                      </div>
                    </motion.div>
                  )}

                  <p className="text-center text-sm text-light-accent/50">
                    Already registered?{' '}
                    <button
                      type="button"
                      onClick={() => switchMode('login')}
                      className="font-semibold text-secondary hover:underline"
                    >
                      Sign in
                    </button>
                  </p>
                </form>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}
