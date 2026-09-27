import StatusBadge from '../components/ui/StatusBadge';
import { BrandMark } from '../components/Brand';
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { chatbotService } from '../services/api';
import { Send, Trash2, Bot, User, MessageSquare, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

const CHAT_SESSION_STORAGE_PREFIX = 'edufusion_chatbot_session_id';

const getChatSessionStorageKey = () => {
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const userId = user.id_student || user.id || user.email || 'guest';
    return `${CHAT_SESSION_STORAGE_PREFIX}:${userId}`;
  } catch {
    return CHAT_SESSION_STORAGE_PREFIX;
  }
};

const getOrCreateSessionId = () => {
  const storageKey = getChatSessionStorageKey();
  const existingSessionId = localStorage.getItem(storageKey);

  if (existingSessionId) return existingSessionId;

  const nextSessionId = crypto.randomUUID();
  localStorage.setItem(storageKey, nextSessionId);
  return nextSessionId;
};

const normalizeCachedMessages = (data, sessionId) => {
  const cachedMessages = Array.isArray(data?.messages)
    ? data.messages
    : Array.isArray(data?.history)
      ? data.history
      : [];

  return cachedMessages
    .map((msg, index) => ({
      role: msg.role || (msg.type === 'human' || msg.sender === 'user' ? 'user' : 'assistant'),
      content: msg.content || msg.message || msg.answer || '',
      sources: msg.sources || msg.top_chunks || [],
      id: msg.id || `${sessionId}-${index}-${msg.role || msg.sender || 'message'}`,
    }))
    .filter(msg => msg.content);
};

const TypingDots = () => (
  <div className="flex gap-1 items-center h-5">
    {[0, 1, 2].map(i => (
      <span key={i} className="w-1.5 h-1.5 rounded-full bg-accent"
            style={{ animation: `blink 1.2s ${i * 0.2}s infinite` }} />
    ))}
  </div>
);

const WakingUp = () => (
  <div className="flex items-center gap-2 text-xs text-accent/60 font-mono">
    <RefreshCw className="w-3 h-3 animate-spin" />
    <span>جاري تشغيل الخدمة، قد يستغرق حتى 30 ثانية…</span>
  </div>
);

const MessageBubble = ({ msg }) => {
  const isUser = msg.role === 'user';
  const isWaking = msg.content === '__waking__';
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'}`}
    >
      <div className={`w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center
        ${isUser
          ? 'bg-secondary'
          : 'bg-surface-2 border border-border'}`}
      >
        {isUser ? <User className="w-4 h-4 text-white" /> : <Bot className="w-4 h-4 text-accent" />}
      </div>
      <div className={`max-w-[75%] rounded-2xl px-4 py-3 text-sm leading-relaxed
        ${isUser ? 'chat-bubble-user text-white rounded-tr-sm' : 'chat-bubble-bot text-light-accent rounded-tl-sm'}`}
      >
        {msg.content === '__typing__' ? <TypingDots /> :
         isWaking ? <WakingUp /> : (
          <p className="whitespace-pre-wrap">{msg.content}</p>
        )}
        {msg.sources && msg.sources.length > 0 && (
          <div className="mt-2 pt-2 border-t border-light-accent/10">
            <p className="text-xs text-light-accent/40 font-mono">Sources referenced</p>
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default function ChatbotPage() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [serviceStatus, setServiceStatus] = useState('checking');
  const [sessionId] = useState(getOrCreateSessionId);
  const messagesRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const loadCachedHistory = async () => {
      try {
        const { data } = await chatbotService.getHistory(sessionId);
        if (!cancelled) {
          setMessages(normalizeCachedMessages(data, sessionId));
        }
      } catch {
        if (!cancelled) {
          setMessages([]);
        }
      } finally {
        if (!cancelled) {
          setHistoryLoading(false);
        }
      }
    };

    loadCachedHistory();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;

    chatbotService.health()
      .then(() => {
        if (!cancelled) setServiceStatus('online');
      })
      .catch(() => {
        if (!cancelled) setServiceStatus('offline');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const area = messagesRef.current;
    area?.scrollTo({ top: area.scrollHeight, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [messages]);

  const sendMessage = useCallback(async (text) => {
    const q = (text || input).trim();
    if (!q || loading) return;

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: q, id: Date.now() }]);
    setLoading(true);

    // Show typing dots first
    setMessages(prev => [...prev, { role: 'assistant', content: '__typing__', id: 'typing' }]);

    // After 4s with no response, switch to "waking up" message
    const wakingTimer = setTimeout(() => {
      setMessages(prev =>
        prev.map(m => m.id === 'typing' ? { ...m, content: '__waking__' } : m)
      );
    }, 4000);

    try {
      const { data } = await chatbotService.sendMessage(q, sessionId);
      clearTimeout(wakingTimer);
      setMessages(prev => [
        ...prev.filter(m => m.id !== 'typing'),
        {
          role: 'assistant',
          content: data.answer || 'لم يصل رد نصي من خدمة البوت.',
          sources: data.top_chunks,
          id: Date.now() + 1,
        }
      ]);
      setServiceStatus('online');
    } catch (err) {
      clearTimeout(wakingTimer);
      setMessages(prev => prev.filter(m => m.id !== 'typing'));

      const serverMsg = err.response?.data?.error;
      const displayMsg = serverMsg || 'الخدمة غير متاحة حالياً، حاول مجدداً بعد لحظة.';

      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: displayMsg, id: Date.now() + 1 }
      ]);
      if (!err.response || err.response.status >= 500) {
        setServiceStatus('offline');
      }
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, loading, sessionId]);

  const clearChat = async () => {
    try {
      await chatbotService.clearHistory(sessionId);
      setMessages([]);
      toast.success('Chat cleared');
    } catch {
      setMessages([]);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="chat-workspace flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
               style={{ background: '#087F75' }}>
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display font-semibold text-light-accent">Academic Chatbot</h1>
            <p className="text-xs text-accent/60 font-mono">Academic assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div role="status"><StatusBadge status={serviceStatus}>{serviceStatus === 'checking' ? 'Checking service' : serviceStatus === 'online' ? 'Online' : 'Offline'}</StatusBadge></div>
          {messages.length > 0 && (
            <button onClick={clearChat}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-light-accent/40 hover:text-red-400 hover:bg-red-400/10 transition-all text-xs">
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={messagesRef} className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        {historyLoading && <p role="status" className="text-sm text-muted">Loading your conversation…</p>}
        <AnimatePresence>
          {!historyLoading && messages.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="chat-empty flex flex-col items-center justify-center">
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                     style={{ background: '#E5F3E9' }}>
                  <BrandMark className="chat-brand-mark" />
                </div>
                <h2 className="font-display text-xl font-semibold text-light-accent mb-2">
                  What would you like to know?
                </h2>
                <p className="text-sm text-light-accent/60 max-w-sm mx-auto leading-relaxed">Ask about university programmes, admissions, or student services.</p>
                <div className="prompt-grid">
                  {['What programmes can I study?', 'How do I apply for admission?', 'What student services are available?', 'Explain the academic registration process.'].map(prompt => <button key={prompt} type="button" onClick={() => { setInput(prompt); inputRef.current?.focus(); }}>{prompt}</button>)}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-border/50 flex-shrink-0">
        {serviceStatus === 'offline' && <p role="status" className="max-w-4xl mx-auto mb-3 text-sm text-red-800">The assistant is currently unavailable. Sending a message will retry the connection; your conversation stays here.</p>}
        <div className="flex gap-3 items-end max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <textarea
              aria-label="Your question"
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type your question..."
              rows={1}
              style={{ resize: 'none', maxHeight: 120 }}
              className="w-full bg-surface/50 border border-border rounded-xl px-4 py-3 text-light-accent placeholder-light-accent/25 focus:outline-none focus:border-accent transition-colors text-sm leading-relaxed"
              onInput={e => {
                e.target.style.height = 'auto';
                e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
              }}
            />
          </div>
          <motion.button
            aria-label="Send question"
            whileTap={{ scale: 0.95 }}
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
            style={{
              background: input.trim() && !loading
                ? '#087F75'
                : 'rgba(8,127,117,0.18)',
            }}
          >
            <Send className={`w-4 h-4 ${input.trim() && !loading ? 'text-white' : 'text-accent/40'}`} />
          </motion.button>
        </div>
      </div>
    </div>
  );
}
