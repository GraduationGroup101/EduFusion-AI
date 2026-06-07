import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  Clock,
  Database,
  Eye,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Trash2,
  Upload,
} from 'lucide-react';
import { adminService, chatbotFilesService } from '../services/api';

const RiskBadge = ({ level }) => {
  const cls = level === 'HIGH'
    ? 'bg-red-500/15 text-red-600 border-red-500/20'
    : level === 'MEDIUM'
      ? 'bg-amber-500/15 text-amber-700 border-amber-500/20'
      : 'bg-green-500/15 text-green-700 border-green-500/20';

  return <span className={`px-2 py-1 rounded-md border text-xs font-medium ${cls}`}>{level}</span>;
};

export function AtRiskStudentsPage() {
  const [students, setStudents] = useState([]);
  const [riskLevel, setRiskLevel] = useState('HIGH');
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);

  const loadStudents = async () => {
    setLoading(true);
    try {
      const { data } = await adminService.getAtRiskStudents({ risk_level: riskLevel, limit: 100 });
      setStudents(data.students || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load at-risk students');
    } finally {
      setLoading(false);
    }
  };

  const runBatch = async () => {
    setRunning(true);
    try {
      const { data } = await adminService.runDemoPredictions(150);
      toast.success(`Updated ${data.total_students} predictions`);
      await loadStudents();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to run predictions');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    loadStudents();
  }, [riskLevel]);

  return (
    <div className="p-6 space-y-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-gradient">At-Risk Students</h1>
          <p className="text-light-accent/55 text-sm mt-1">Monitor students ordered by latest model risk score.</p>
        </div>
        <button
          onClick={runBatch}
          disabled={running}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent text-white text-sm font-medium disabled:opacity-60"
        >
          {running ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          Run Demo Batch
        </button>
      </motion.div>

      <div className="glass rounded-2xl p-4 glow-border flex items-center gap-3">
        <Search className="w-4 h-4 text-accent" />
        <select
          value={riskLevel}
          onChange={(e) => setRiskLevel(e.target.value)}
          className="bg-surface border border-border rounded-lg px-3 py-2 text-sm text-light-accent focus:outline-none focus:border-accent"
        >
          <option value="HIGH">High Risk</option>
          <option value="MEDIUM">Medium Risk</option>
          <option value="LOW">Low Risk</option>
        </select>
        <button onClick={loadStudents} className="px-3 py-2 rounded-lg border border-border text-sm text-light-accent hover:bg-secondary/10">
          Refresh
        </button>
      </div>

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5 glow-border">
        <div className="flex items-center gap-2 mb-4">
          <AlertTriangle className="w-5 h-5 text-accent" />
          <h2 className="font-display font-semibold text-light-accent">Latest Results</h2>
        </div>
        {loading ? (
          <div className="h-32 flex items-center justify-center text-light-accent/40">Loading...</div>
        ) : students.length === 0 ? (
          <div className="h-32 flex items-center justify-center text-light-accent/40">No students found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border">
                  {['Student ID', 'Course', 'Day', 'Risk', 'Probability', 'Action', 'Updated'].map((h) => (
                    <th key={h} className="pb-3 pr-4 text-xs font-mono text-light-accent/50 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {students.map((row) => (
                  <tr key={`${row.enrollment_id}-${row.day_of_course}`} className="hover:bg-secondary/5">
                    <td className="py-3 pr-4 font-medium text-light-accent">{row.id_student}</td>
                    <td className="py-3 pr-4 text-light-accent/70">{row.code_module} / {row.code_presentation}</td>
                    <td className="py-3 pr-4 font-mono text-light-accent/70">{row.day_of_course}</td>
                    <td className="py-3 pr-4"><RiskBadge level={row.risk_level} /></td>
                    <td className="py-3 pr-4 font-mono text-light-accent/80">{(row.risk_probability * 100).toFixed(1)}%</td>
                    <td className="py-3 pr-4 text-light-accent/55 max-w-xs truncate">{row.recommended_action || '-'}</td>
                    <td className="py-3 pr-4 text-light-accent/40 font-mono text-xs">{new Date(row.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </motion.div>
    </div>
  );
}

const getResponseMessage = (data) => {
  if (typeof data === 'string') return data;
  if (data?.message) return data.message;
  if (data?.detail) return Array.isArray(data.detail) ? data.detail.map((item) => item.msg).join(', ') : data.detail;
  if (data?.error) return data.error;
  return JSON.stringify(data, null, 2);
};

const normalizeFiles = (data) => {
  const rawFiles = Array.isArray(data)
    ? data
    : Array.isArray(data?.files)
      ? data.files
      : Array.isArray(data?.collections)
        ? data.collections
        : Array.isArray(data?.uploaded_files)
          ? data.uploaded_files
          : Array.isArray(data?.data)
            ? data.data
            : typeof data === 'string'
              ? data.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
              : [];

  return rawFiles.map((item) => {
    if (typeof item === 'string') {
      return { collection_name: item, label: item };
    }

    const collectionName = item.collection_name || item.collection || item.name || item.filename || item.file || '';
    return {
      ...item,
      collection_name: collectionName,
      label: collectionName || JSON.stringify(item),
    };
  }).filter((item) => item.collection_name);
};

export function ChatbotFilesPage() {
  const [files, setFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [collectionName, setCollectionName] = useState('');
  const [selectedCollection, setSelectedCollection] = useState('');
  const [question, setQuestion] = useState('');
  const [chatResult, setChatResult] = useState(null);
  const [chunks, setChunks] = useState(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [actionCollection, setActionCollection] = useState('');

  const loadFiles = async () => {
    setLoading(true);
    try {
      const { data } = await chatbotFilesService.listFiles();
      const nextFiles = normalizeFiles(data);
      setFiles(nextFiles);
      if (!selectedCollection && nextFiles[0]?.collection_name) {
        setSelectedCollection(nextFiles[0].collection_name);
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load chatbot files');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const handleFileChange = (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.json')) {
      toast.error('Only .json files are allowed');
      return;
    }
    setSelectedFile(file);
    if (!collectionName.trim()) {
      setCollectionName(file.name.replace(/\.json$/i, ''));
    }
  };

  const uploadFile = async (e) => {
    e.preventDefault();

    if (!selectedFile) {
      toast.error('Choose a .json file first');
      return;
    }

    setUploading(true);
    try {
      const { data } = await chatbotFilesService.uploadFile({
        file: selectedFile,
        collection_name: collectionName,
      });
      toast.success(getResponseMessage(data) || 'File uploaded');
      setSelectedFile(null);
      setCollectionName('');
      await loadFiles();
    } catch (err) {
      toast.error(err.response?.data?.error || getResponseMessage(err.response?.data) || 'Failed to upload file');
    } finally {
      setUploading(false);
    }
  };

  const reloadFile = async (collection) => {
    setActionCollection(collection);
    try {
      const { data } = await chatbotFilesService.reloadFile(collection);
      toast.success(getResponseMessage(data) || 'File reloaded');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reload file');
    } finally {
      setActionCollection('');
    }
  };

  const deleteFile = async (collection) => {
    setActionCollection(collection);
    try {
      const { data } = await chatbotFilesService.deleteFile(collection);
      toast.success(getResponseMessage(data) || 'File deleted');
      if (selectedCollection === collection) setSelectedCollection('');
      await loadFiles();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to delete file');
    } finally {
      setActionCollection('');
    }
  };

  const loadChunks = async (collection) => {
    setActionCollection(collection);
    try {
      const { data } = await chatbotFilesService.getChunks(collection);
      setChunks({ collection, data });
      setSelectedCollection(collection);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load chunks');
    } finally {
      setActionCollection('');
    }
  };

  const askFile = async (e) => {
    e.preventDefault();

    if (!selectedCollection.trim()) {
      toast.error('Choose a collection');
      return;
    }

    if (!question.trim()) {
      toast.error('Write a question');
      return;
    }

    setLoading(true);
    setChatResult(null);
    try {
      const { data } = await chatbotFilesService.chatWithFile({
        question: question.trim(),
        collection_name: selectedCollection.trim(),
        session_id: `admin-file-${selectedCollection.trim()}`,
      });
      setChatResult(data);
    } catch (err) {
      toast.error(err.response?.data?.error || getResponseMessage(err.response?.data) || 'Failed to chat with file');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-gradient">Chatbot Files</h1>
          <p className="text-light-accent/55 text-sm mt-1">Upload JSON collections and manage chatbot file knowledge.</p>
        </div>
        <button onClick={loadFiles} className="flex items-center justify-center gap-2 px-4 py-2 rounded-xl border border-border text-light-accent text-sm hover:bg-secondary/10">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </motion.div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,420px)_1fr] gap-5">
        <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} onSubmit={uploadFile} className="glass rounded-2xl p-5 glow-border space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: '#76ABAE' }}>
              <Upload className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="font-display font-semibold text-light-accent">Upload JSON</h2>
              <p className="text-xs text-light-accent/45">Only .json files are accepted.</p>
            </div>
          </div>

          <label className="min-h-[150px] rounded-xl border-2 border-dashed border-secondary/35 bg-white/70 hover:border-accent/45 transition-colors flex flex-col items-center justify-center gap-3 px-4 text-center cursor-pointer">
            <input
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(e) => handleFileChange(e.target.files?.[0])}
            />
            <FileText className="w-8 h-8 text-accent" />
            <div>
              <p className="text-sm font-semibold text-light-accent">{selectedFile ? selectedFile.name : 'Choose JSON file'}</p>
              <p className="text-xs text-light-accent/45 mt-1">{selectedFile ? `${(selectedFile.size / 1024).toFixed(1)} KB` : 'Click to browse'}</p>
            </div>
          </label>

          <input
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
            placeholder="Collection name (optional)"
            className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm text-light-accent focus:outline-none focus:border-accent"
          />

          <button disabled={uploading || !selectedFile} className="w-full h-11 rounded-xl bg-accent text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
            {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {uploading ? 'Uploading...' : 'Upload File'}
          </button>
        </motion.form>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5 glow-border">
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-5 h-5 text-accent" />
            <h2 className="font-display font-semibold text-light-accent">Uploaded Collections</h2>
          </div>

          {loading && files.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-light-accent/40">Loading...</div>
          ) : files.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-light-accent/40">No files uploaded</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b border-border">
                    {['Collection', 'Actions'].map((h) => (
                      <th key={h} className="pb-3 pr-4 text-xs font-mono text-light-accent/50 uppercase">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {files.map((file) => (
                    <tr key={file.collection_name} className="hover:bg-secondary/5">
                      <td className="py-3 pr-4 text-light-accent font-medium">
                        <button
                          onClick={() => setSelectedCollection(file.collection_name)}
                          className="text-left hover:text-accent transition-colors"
                        >
                          {file.label}
                        </button>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-wrap gap-2">
                          <button onClick={() => loadChunks(file.collection_name)} className="w-9 h-9 rounded-lg border border-border bg-white text-light-accent/70 hover:text-light-accent flex items-center justify-center" title="View chunks">
                            <Eye className="w-4 h-4" />
                          </button>
                          <button onClick={() => reloadFile(file.collection_name)} className="w-9 h-9 rounded-lg border border-border bg-white text-light-accent/70 hover:text-light-accent flex items-center justify-center" title="Reload">
                            {actionCollection === file.collection_name ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                          </button>
                          <button onClick={() => deleteFile(file.collection_name)} className="w-9 h-9 rounded-lg border border-border bg-white text-red-500/75 hover:text-red-600 flex items-center justify-center" title="Delete">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </motion.div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        <motion.form initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} onSubmit={askFile} className="glass rounded-2xl p-5 glow-border space-y-4">
          <div className="flex items-center gap-2">
            <Send className="w-5 h-5 text-accent" />
            <h2 className="font-display font-semibold text-light-accent">Chat With Collection</h2>
          </div>

          <input
            value={selectedCollection}
            onChange={(e) => setSelectedCollection(e.target.value)}
            placeholder="Collection name"
            className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm text-light-accent focus:outline-none focus:border-accent"
          />
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a question about this file..."
            rows={4}
            className="w-full bg-surface border border-border rounded-xl px-4 py-3 text-sm text-light-accent focus:outline-none focus:border-accent resize-none"
          />
          <button disabled={loading || !selectedCollection.trim() || !question.trim()} className="h-11 rounded-xl bg-accent text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Ask File
          </button>

          {chatResult && (
            <div className="rounded-xl border border-border bg-white p-4 space-y-3">
              <p className="text-sm text-light-accent whitespace-pre-wrap">{chatResult.answer}</p>
              <p className="text-xs font-mono text-light-accent/40">Source: {chatResult.source || chatResult.collection_name || selectedCollection}</p>
            </div>
          )}
        </motion.form>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-5 glow-border">
          <div className="flex items-center gap-2 mb-4">
            <FileText className="w-5 h-5 text-accent" />
            <h2 className="font-display font-semibold text-light-accent">Chunks Preview</h2>
          </div>
          {chunks ? (
            <pre className="max-h-[360px] overflow-auto rounded-xl border border-border bg-white p-4 whitespace-pre-wrap text-xs leading-relaxed text-light-accent">
              {typeof chunks.data === 'string' ? chunks.data : JSON.stringify(chunks.data, null, 2)}
            </pre>
          ) : (
            <div className="h-40 flex items-center justify-center text-light-accent/40">Select a collection to view chunks</div>
          )}
        </motion.div>
      </div>
    </div>
  );
}

export function AcademicClockPage() {
  const [clocks, setClocks] = useState([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [globalDay, setGlobalDay] = useState(60);

  const loadClocks = async () => {
    setLoading(true);
    try {
      const { data } = await adminService.getClocks();
      setClocks(data.clocks || []);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to load academic clocks');
    } finally {
      setLoading(false);
    }
  };

  const recomputePredictions = async () => {
    const { data } = await adminService.runDemoPredictions(150);
    return data;
  };

  const tickAll = async (days) => {
    setRunning(true);
    try {
      const { data } = await adminService.tickAllClocks(days);
      toast.success(`Updated ${data.updatedClocks} clocks and recomputed ${data.predictions?.total_students || 0} predictions`);
      await loadClocks();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update clocks and predictions');
    } finally {
      setRunning(false);
    }
  };

  const resetAll = async (day) => {
    setRunning(true);
    try {
      const { data } = await adminService.resetAllClocks(day);
      toast.success(`Reset ${data.updatedClocks} clocks to day ${day} and recomputed ${data.predictions?.total_students || 0} predictions`);
      await loadClocks();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to reset clocks and predictions');
    } finally {
      setRunning(false);
    }
  };

  const runPredictions = async () => {
    setRunning(true);
    try {
      const data = await recomputePredictions();
      toast.success(`Recomputed ${data.total_students} predictions`);
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to run predictions');
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    loadClocks();
  }, []);

  return (
    <div className="p-6 space-y-6">
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-gradient">Academic Clock</h1>
          <p className="text-light-accent/55 text-sm mt-1">Control one simulated day shared by all students and course presentations.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={runPredictions} disabled={running} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-60">
            {running ? 'Updating...' : 'Update Predictions'}
          </button>
          <button onClick={loadClocks} className="px-3 py-2 rounded-lg border border-border text-sm text-light-accent hover:bg-secondary/10">
            Refresh
          </button>
        </div>
      </motion.div>

      <div className="rounded-2xl border border-amber-500/25 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
        Changing the academic clock also recomputes demo predictions, so risk levels and student counts refresh for the new day.
      </div>

      <div className="glass rounded-2xl p-6 glow-border space-y-5">
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-accent" />
          <div>
            <h2 className="font-display font-semibold text-light-accent">Unified Clock Control</h2>
            <p className="text-xs text-light-accent/45">Changes apply to every student because predictions read the course clock before running the model.</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button disabled={running} onClick={() => tickAll(1)} className="px-4 py-2 rounded-lg bg-secondary text-white text-sm font-medium disabled:opacity-60">+1 day for all</button>
          <button disabled={running} onClick={() => tickAll(10)} className="px-4 py-2 rounded-lg bg-secondary text-white text-sm font-medium disabled:opacity-60">+10 days for all</button>
          <input
            type="number"
            min="0"
            value={globalDay}
            onChange={(e) => setGlobalDay(e.target.value)}
            className="w-28 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-light-accent focus:outline-none focus:border-accent"
          />
          <button disabled={running} onClick={() => resetAll(Number(globalDay))} className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-60">
            <RotateCcw className="w-4 h-4" />
            Set all clocks
          </button>
          <button onClick={runPredictions} disabled={running} className="px-4 py-2 rounded-lg border border-border text-light-accent text-sm font-medium hover:bg-secondary/10 disabled:opacity-60">
            {running ? 'Recomputing...' : 'Recompute after change'}
          </button>
        </div>
      </div>

      <div className="glass rounded-2xl p-5 glow-border">
        <h2 className="font-display font-semibold text-light-accent mb-4">Clock Snapshot</h2>
        {loading ? (
          <div className="h-24 flex items-center justify-center text-light-accent/40">Loading...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left border-b border-border">
                  {['Course', 'Current Day', 'Max Day', 'Progress'].map((h) => (
                    <th key={h} className="pb-3 pr-4 text-xs font-mono text-light-accent/50 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {clocks.map((clock) => {
                  const pct = Math.round((clock.current_day / clock.max_day) * 100);
                  return (
                    <tr key={clock.id}>
                      <td className="py-3 pr-4 text-light-accent font-medium">{clock.code_module} / {clock.code_presentation}</td>
                      <td className="py-3 pr-4 text-light-accent/75 font-mono">{clock.current_day}</td>
                      <td className="py-3 pr-4 text-light-accent/55 font-mono">{clock.max_day}</td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-32 rounded-full bg-surface-2 overflow-hidden">
                            <div className="h-full bg-secondary" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-xs text-light-accent/50 font-mono">{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
