import { motion } from 'framer-motion';
import { Sparkles, Construction } from 'lucide-react';

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
        {['API endpoint configured', 'Request/Response schema defined', 'UI components ready', 'Error handling in place'].map((item, i) => (
          <div key={i} className="flex items-center gap-2 text-sm">
            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center
              ${i < 3 ? 'border-accent bg-accent/20' : 'border-border'}`}>
              {i < 3 && <span className="text-accent text-xs">✓</span>}
            </div>
            <span className={i < 3 ? 'text-light-accent/70' : 'text-light-accent/30'}>{item}</span>
          </div>
        ))}
      </div>

      <p className="text-xs text-light-accent/25 mt-6 font-mono">
        Send the API details to connect this tool
      </p>
    </motion.div>
  </div>
);

export function AIToolPage() {
  return <PlaceholderPage
    title="AI Prediction Tool"
    description="Advanced machine learning model for predicting student academic outcomes and risk assessment. Connect your API to activate."
    icon={Sparkles}
    accentColor="#FF5722"
  />;
}

export function QuestionGeneratorPage() {
  const { FileQuestion } = require('lucide-react');
  return <PlaceholderPage
    title="Question Generator"
    description="Automatically generate exam questions and assessments from course materials using AI. Connect your API to activate."
    icon={FileQuestion}
    accentColor="#76ABAE"
  />;
}

export function YouTubeExtractorPage() {
  const { Youtube } = require('lucide-react');
  return <PlaceholderPage
    title="YouTube Question Extractor"
    description="Extract key concepts and generate questions from educational YouTube videos automatically. Connect your API to activate."
    icon={Youtube}
    accentColor="#ef4444"
  />;
}
