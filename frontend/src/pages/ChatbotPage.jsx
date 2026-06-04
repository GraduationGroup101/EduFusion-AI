import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { chatbotService } from '../services/api';
import { Send, Trash2, Bot, User, MessageSquare, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { v4 as uuidv4 } from 'uuid';

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
          ? 'bg-gradient-to-br from-secondary to-accent'
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
  const [sessionId] = useState(() => uuidv4());
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
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
        { role: 'assistant', content: data.answer, sources: data.top_chunks, id: Date.now() + 1 }
      ]);
    } catch (err) {
      clearTimeout(wakingTimer);
      setMessages(prev => prev.filter(m => m.id !== 'typing'));

      const serverMsg = err.response?.data?.error;
      const displayMsg = serverMsg || 'الخدمة غير متاحة حالياً، حاول مجدداً بعد لحظة.';

      setMessages(prev => [
        ...prev,
        { role: 'assistant', content: displayMsg, id: Date.now() + 1 }
      ]);
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
    <div className="flex flex-col h-screen">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center"
               style={{ background: '#76ABAE' }}>
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-display font-semibold text-light-accent">IUG AI Chatbot</h1>
            <p className="text-xs text-accent/60 font-mono">Academic assistant</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-green-500/10 border border-green-500/20">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
            <span className="text-xs text-green-400 font-mono">Online</span>
          </div>
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
      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5">
        <AnimatePresence>
          {messages.length === 0 && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex flex-col items-center justify-center h-full pt-12">
              <div className="text-center">
                <div className="w-16 h-16 rounded-2xl mx-auto mb-4 flex items-center justify-center"
                     style={{ background: '#76ABAE' }}>
                  <Bot className="w-8 h-8 text-white" />
                </div>
                <h2 className="font-display text-xl font-semibold text-light-accent mb-2">
                  How can I help?
                </h2>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="px-6 py-4 border-t border-border/50 flex-shrink-0">
        <div className="flex gap-3 items-end max-w-4xl mx-auto">
          <div className="flex-1 relative">
            <textarea
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
            whileTap={{ scale: 0.95 }}
            onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-all"
            style={{
              background: input.trim() && !loading
                ? '#76ABAE'
                : 'rgba(118,171,174,0.18)',
            }}
          >
            <Send className={`w-4 h-4 ${input.trim() && !loading ? 'text-white' : 'text-accent/40'}`} />
          </motion.button>
        </div>
      </div>
    </div>
  );
}