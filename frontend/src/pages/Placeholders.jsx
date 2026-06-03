import { motion } from 'framer-motion';
import { Sparkles, FileQuestion, Youtube, Construction } from 'lucide-react';

const PlaceholderPage = ({ title, description, icon: Icon, accentColor = '#FF5722' }) => (
  <div className="flex flex-col h-full items-center justify-center p-8">
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center max-w-md"
    >
      <div className="w-20 h-20 rounded-3xl mx-auto mb-6 flex items-center justify-center relative"
           style={{ background: `linear-gradient(135deg, ${accentColor}30, ${accentColor}15)`, border: `1px solid ${accentColor}30` }}>
        <Icon className="w-10 h-10" style={{ color: accentColor }} />
        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-amber-500 flex items-center justify-center">
          <Construction className="w-3 h-3 text-white" />
        </div>
      </div>

      <h1 className="font-display text-2xl font-bold text-gradient mb-3">{title}</h1>
      <p className="text-light-accent/50 text-sm leading-relaxed mb-8">{description}</p>

      <div className="glass rounded-2xl p-5 glow-border text-left space-y-3">
        <p className="text-xs font-mono text-accent uppercase tracking-wider">Integration Checklist</p>
        {[
          { label: 'API endpoint configured', done: true },
          { label: 'Request/Response schema defined', done: true },
          { label: 'UI components scaffolded', done: true },
          { label: 'API key / credentials connected', done: false },
        ].map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0
              ${item.done ? 'border-accent bg-accent/20' : 'border-border'}`}>
              {item.done && <span className="text-accent text-xs leading-none">✓</span>}
            </div>
            <span className={item.done ? 'text-light-accent/70' : 'text-light-accent/30'}>{item.label}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-light-accent/25 mt-6 font-mono">
        Share the API details to connect this tool
      </p>
    </motion.div>
  </div>
);

export function AIToolPage() {
  return <PlaceholderPage
    title="AI Prediction Tool"
    description="Advanced ML model for predicting student academic outcomes and risk levels. Connect your API to activate this tool."
    icon={Sparkles}
    accentColor="#FF5722"
  />;
}

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
