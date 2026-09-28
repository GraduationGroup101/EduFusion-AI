import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Copy,
  FileQuestion,
  FileText,
  Loader2,
  Minus,
  Plus,
  RotateCcw,
  Search,
  TrendingUp,
  Upload,
} from 'lucide-react';
import { adminService, questionGeneratorService } from '../services/api';
import PageHeader from '../components/ui/PageHeader';
import EmptyState from '../components/ui/EmptyState';
import StatusBadge from '../components/ui/StatusBadge';

export function AIToolPage() {
  const [studentId, setStudentId] = useState('');
  const [codeModule, setCodeModule] = useState('');
  const [codePresentation, setCodePresentation] = useState('');
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchError, setSearchError] = useState('');

  const searchStudent = async (e) => {
    e.preventDefault();
    if (!studentId.trim()) {
      toast.error('Enter a student ID');
      return;
    }

    setLoading(true);
    setSearchError('');
    try {
      const params = {};
      if (codeModule.trim()) params.code_module = codeModule.trim().toUpperCase();
      if (codePresentation.trim()) params.code_presentation = codePresentation.trim();
      const { data } = await adminService.getStudentPrediction(studentId.trim(), params);
      setPrediction(data);
    } catch (err) {
      setSearchError('We could not load this prediction. Check the student ID and course details, then try again.');
      toast.error(err.response?.data?.detail || err.response?.data?.error || 'Failed to fetch student prediction');
      setPrediction(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="EduPredict" icon={TrendingUp} description="Find a student’s academic risk outlook using the current academic day." />

      <form onSubmit={searchStudent} className="glass rounded-2xl p-5 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 items-end gap-4">
        <label className="field-label">Student ID
        <input
          id="student-search"
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          placeholder="Student ID"
          className="bg-surface border border-border rounded-xl px-4 py-3 text-sm text-light-accent focus:outline-none focus:border-accent"
        />
        </label>
        <label className="field-label">Course module (optional)
        <input
          value={codeModule}
          onChange={(e) => setCodeModule(e.target.value)}
          placeholder="Course module (optional)"
          className="bg-surface border border-border rounded-xl px-4 py-3 text-sm text-light-accent focus:outline-none focus:border-accent"
        />
        </label>
        <label className="field-label">Presentation (optional)
        <input
          value={codePresentation}
          onChange={(e) => setCodePresentation(e.target.value)}
          placeholder="Presentation (optional)"
          className="bg-surface border border-border rounded-xl px-4 py-3 text-sm text-light-accent focus:outline-none focus:border-accent"
        />
        </label>
        <button disabled={loading} className="flex items-center justify-center gap-2 rounded-xl bg-secondary px-4 py-3 text-sm font-medium text-white disabled:opacity-60">
          <Search className="w-4 h-4" />
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

      {searchError && <p role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-800">{searchError}</p>}
      {!prediction && !loading && !searchError && <EmptyState icon={Search} title="A clearer path starts with a student" description="Enter a student ID above. Add a course module and presentation to narrow the search to a specific enrollment.">
        <button className="text-secondary text-sm font-semibold underline" onClick={() => document.getElementById('student-search')?.focus()}>Find a student</button>
      </EmptyState>}
      {loading && <div role="status" className="empty-state"><Loader2 className="animate-spin text-secondary" /><p>Finding the latest academic outlook…</p></div>}

      {prediction && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 glow-border space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs font-mono uppercase text-light-accent/45">Risk Level</p>
              <p className="text-2xl font-display font-bold text-light-accent">{prediction.risk_level}</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase text-light-accent/45">Probability</p>
              <p className="text-2xl font-display font-bold text-light-accent">{(prediction.risk_probability * 100).toFixed(1)}%</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase text-light-accent/45">At Risk</p>
              <p className="text-2xl font-display font-bold text-light-accent">{prediction.at_risk ? 'Yes' : 'No'}</p>
            </div>
            <div>
              <p className="text-xs font-mono uppercase text-light-accent/45">Day</p>
              <p className="text-2xl font-display font-bold text-light-accent">{prediction.model_confidence?.day_of_course}</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-mono uppercase text-light-accent/45 mb-2">Recommended Action</p>
            <p className="text-sm text-light-accent">{prediction.recommended_action}</p>
          </div>

          <div>
            <p className="text-xs font-mono uppercase text-light-accent/45 mb-2">Reasons</p>
            <ul className="space-y-2">
              {(prediction.explanation || []).map((item, index) => (
                <li key={index} className="rounded-xl border border-border bg-surface/70 px-4 py-3 text-sm text-light-accent/75">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </motion.div>
      )}
    </div>
  );
}

const QuestionCountControl = ({ label, value, onChange }) => {
  const updateValue = (nextValue) => {
    const parsed = Number(nextValue);
    onChange(Number.isFinite(parsed) ? Math.max(0, Math.min(50, parsed)) : 0);
  };

  return (
    <div className="question-counter">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-light-accent">{label}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => updateValue(value - 1)}
            className="w-8 h-8 rounded-lg border border-border bg-white text-light-accent/70 hover:text-light-accent hover:border-accent/50 transition-colors flex items-center justify-center"
            aria-label={`Decrease ${label}`}
          >
            <Minus className="w-4 h-4" />
          </button>
          <input
            aria-label={`${label} questions`}
            type="number"
            min="0"
            max="50"
            value={value}
            onChange={(e) => updateValue(e.target.value)}
            className="w-14 h-8 rounded-lg border border-border bg-white text-center text-sm font-semibold text-light-accent focus:outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => updateValue(value + 1)}
            className="w-8 h-8 rounded-lg border border-border bg-white text-light-accent/70 hover:text-light-accent hover:border-accent/50 transition-colors flex items-center justify-center"
            aria-label={`Increase ${label}`}
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export function QuestionGeneratorPage() {
  const fileInputRef = useRef(null);
  const [serviceStatus, setServiceStatus] = useState('checking');
  const [file, setFile] = useState(null);
  const [numMcq, setNumMcq] = useState(5);
  const [numTf, setNumTf] = useState(5);
  const [numEssay, setNumEssay] = useState(3);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const totalQuestions = useMemo(() => numMcq + numTf + numEssay, [numMcq, numTf, numEssay]);
  const questionsText = result?.questions || '';

  useEffect(() => {
    let cancelled = false;

    const checkHealth = async () => {
      try {
        await questionGeneratorService.health();
        if (!cancelled) setServiceStatus('online');
      } catch {
        if (!cancelled) setServiceStatus('offline');
      }
    };

    checkHealth();

    return () => {
      cancelled = true;
    };
  }, []);

  const selectFile = (selectedFile) => {
    if (!selectedFile) return;
    if (selectedFile.size > 4 * 1024 * 1024) { toast.error('Choose a file smaller than 4 MB'); return; }
    if (!/\.(pdf|docx?|txt|pptx?)$/i.test(selectedFile.name)) { toast.error('Choose a supported document'); return; }
    setFile(selectedFile);
    setResult(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    selectFile(e.dataTransfer.files?.[0]);
  };

  const handleGenerate = async (e) => {
    e.preventDefault();

    if (!file) {
      toast.error('Choose a file first');
      return;
    }

    if (totalQuestions <= 0) {
      toast.error('Choose at least one question');
      return;
    }

    setLoading(true);
    setResult(null);

    try {
      const { data } = await questionGeneratorService.generate({
        file,
        num_mcq: numMcq,
        num_tf: numTf,
        num_essay: numEssay,
      });

      setResult(data);
      toast.success(data.message || 'Questions generated');
    } catch (err) {
      const detail = err.response?.data?.detail;
      const validationMessage = Array.isArray(detail)
        ? detail.map((item) => item.msg).join(', ')
        : detail;
      toast.error(validationMessage || err.response?.data?.error || 'Failed to generate questions');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFile(null);
    setNumMcq(5);
    setNumTf(5);
    setNumEssay(3);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const copyQuestions = async () => {
    if (!questionsText) return;
    await navigator.clipboard.writeText(questionsText);
    toast.success('Copied');
  };

  return (
    <div className="question-generator-page p-6 space-y-6">
      <PageHeader title="Quiz Generator" icon={FileQuestion} tone="cream" description="Turn your course material into purposeful practice.">
        <div role="status"><StatusBadge status={serviceStatus}>{serviceStatus === 'checking' ? 'Checking quiz service' : serviceStatus === 'online' ? 'Service online' : 'Service unavailable'}</StatusBadge></div>
      </PageHeader>
      {serviceStatus === 'offline' && <p className="text-sm text-muted">The quiz service is unavailable. You can prepare your file and question counts, then try generating again.</p>}

      <form onSubmit={handleGenerate} className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-5">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5 glow-border space-y-5">
          <input
            ref={fileInputRef}
            type="file"
            hidden
            className="hidden"
            accept=".pdf,.doc,.docx,.txt,.ppt,.pptx"
            onChange={(e) => selectFile(e.target.files?.[0])}
          />

          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="file-upload w-full rounded-xl border-2 border-dashed border-secondary/35 bg-white/70 hover:border-accent/45 hover:bg-white transition-colors flex flex-col items-center justify-center gap-4 px-5 text-center"
          >
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center" style={{ background: '#087F75' }}>
              {file ? <FileText className="w-7 h-7 text-white" /> : <Upload className="w-7 h-7 text-white" />}
            </div>
            <div>
              <p className="text-base font-semibold text-light-accent break-all">
                {file ? file.name : 'Upload course file'}
              </p>
              <p className="text-xs text-light-accent/45 mt-1">
                {file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'PDF, Word, PowerPoint, or text · Up to 4 MB'}
              </p>
            </div>
          </button>

          <div className="question-counts">
            <QuestionCountControl label="Multiple Choice" value={numMcq} onChange={setNumMcq} />
            <QuestionCountControl label="True / False" value={numTf} onChange={setNumTf} />
            <QuestionCountControl label="Essay" value={numEssay} onChange={setNumEssay} />
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              type="submit"
              disabled={loading || !file || totalQuestions <= 0}
              className="generate-button h-11 flex-1 rounded-xl bg-secondary text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileQuestion className="w-4 h-4" />}
              {loading ? 'Generating...' : `Generate ${totalQuestions} Questions`}
            </button>
            <button
              type="button"
              onClick={resetForm}
              className="h-11 rounded-xl border border-border bg-white px-4 text-sm font-medium text-light-accent/70 hover:text-light-accent hover:border-accent/45 transition-colors flex items-center justify-center gap-2"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          </div>
        </motion.div>

        <motion.aside initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5 glow-border h-fit space-y-4">
          <div>
            <p className="text-xs font-mono uppercase text-light-accent/45">Request</p>
            <p className="text-3xl font-display font-bold text-light-accent mt-1">{totalQuestions}</p>
          </div>
          <div className="space-y-2 text-sm text-light-accent/70">
            <div className="flex justify-between"><span>MCQ</span><span className="font-semibold text-light-accent">{numMcq}</span></div>
            <div className="flex justify-between"><span>True / False</span><span className="font-semibold text-light-accent">{numTf}</span></div>
            <div className="flex justify-between"><span>Essay</span><span className="font-semibold text-light-accent">{numEssay}</span></div>
          </div>
          {result?.filename && (
            <div className="rounded-xl border border-border bg-white px-4 py-3">
              <p className="text-xs font-mono uppercase text-light-accent/40">Generated From</p>
              <p className="text-sm text-light-accent truncate mt-1">{result.filename}</p>
            </div>
          )}
        </motion.aside>
      </form>

      {questionsText && (
        <motion.section initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5 glow-border">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-display text-lg font-semibold text-light-accent">Generated Questions</h2>
              <p className="text-xs text-light-accent/45 mt-1">{result?.message || 'Ready'}</p>
            </div>
            <button
              type="button"
              onClick={copyQuestions}
              className="w-10 h-10 rounded-xl border border-border bg-white text-light-accent/65 hover:text-light-accent hover:border-accent/45 transition-colors flex items-center justify-center"
              aria-label="Copy questions"
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <pre className="max-h-[520px] overflow-auto rounded-xl border border-border bg-white p-4 whitespace-pre-wrap text-sm leading-relaxed text-light-accent">
            {questionsText}
          </pre>
        </motion.section>
      )}
    </div>
  );
}
