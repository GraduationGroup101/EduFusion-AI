import { useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import { Construction, FileQuestion, Search, Sparkles, Youtube } from 'lucide-react';
import { adminService } from '../services/api';

export function AIToolPage() {
  const [studentId, setStudentId] = useState('');
  const [codeModule, setCodeModule] = useState('');
  const [codePresentation, setCodePresentation] = useState('');
  const [prediction, setPrediction] = useState(null);
  const [loading, setLoading] = useState(false);

  const searchStudent = async (e) => {
    e.preventDefault();
    if (!studentId.trim()) {
      toast.error('Enter a student ID');
      return;
    }

    setLoading(true);
    try {
      const params = {};
      if (codeModule.trim()) params.code_module = codeModule.trim().toUpperCase();
      if (codePresentation.trim()) params.code_presentation = codePresentation.trim();
      const { data } = await adminService.getStudentPrediction(studentId.trim(), params);
      setPrediction(data);
    } catch (err) {
      toast.error(err.response?.data?.detail || err.response?.data?.error || 'Failed to fetch student prediction');
      setPrediction(null);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <h1 className="font-display text-2xl font-bold text-gradient">Prediction Tool</h1>
        <p className="text-light-accent/55 text-sm mt-1">Search for a student and run the model using the current academic clock.</p>
      </motion.div>

      <form onSubmit={searchStudent} className="glass rounded-2xl p-5 glow-border grid grid-cols-1 md:grid-cols-4 gap-3">
        <input
          value={studentId}
          onChange={(e) => setStudentId(e.target.value)}
          placeholder="Student ID"
          className="bg-surface border border-border rounded-xl px-4 py-3 text-sm text-light-accent focus:outline-none focus:border-accent"
        />
        <input
          value={codeModule}
          onChange={(e) => setCodeModule(e.target.value)}
          placeholder="Course module (optional)"
          className="bg-surface border border-border rounded-xl px-4 py-3 text-sm text-light-accent focus:outline-none focus:border-accent"
        />
        <input
          value={codePresentation}
          onChange={(e) => setCodePresentation(e.target.value)}
          placeholder="Presentation (optional)"
          className="bg-surface border border-border rounded-xl px-4 py-3 text-sm text-light-accent focus:outline-none focus:border-accent"
        />
        <button disabled={loading} className="flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-sm font-medium text-white disabled:opacity-60">
          <Search className="w-4 h-4" />
          {loading ? 'Searching...' : 'Search'}
        </button>
      </form>

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

const PlaceholderPage = ({ title, description, icon: Icon, accentColor = '#FF5722' }) => (
  <div className="flex flex-col h-full items-center justify-center p-8">
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-center max-w-md">
      <div className="w-20 h-20 rounded-3xl mx-auto mb-6 flex items-center justify-center relative"
           style={{ background: `linear-gradient(135deg, ${accentColor}30, ${accentColor}15)`, border: `1px solid ${accentColor}30` }}>
        <Icon className="w-10 h-10" style={{ color: accentColor }} />
        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
          <Construction className="w-3 h-3 text-white" />
        </div>
      </div>
      <h1 className="font-display text-2xl font-bold text-gradient mb-3">{title}</h1>
      <p className="text-light-accent/50 text-sm leading-relaxed mb-8">{description}</p>
    </motion.div>
  </div>
);

export function QuestionGeneratorPage() {
  return <PlaceholderPage
    title="Question Generator"
    description="Automatically generate exam questions from course materials using AI. Connect your API to activate."
    icon={FileQuestion}
    accentColor="#76ABAE"
  />;
}

export function YouTubeExtractorPage() {
  return <PlaceholderPage
    title="YouTube Question Extractor"
    description="Extract key concepts and generate questions from educational YouTube videos. Connect your API to activate."
    icon={Youtube}
    accentColor="#f87171"
  />;
}
