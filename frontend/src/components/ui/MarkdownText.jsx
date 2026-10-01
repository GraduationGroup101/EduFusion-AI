import { useMemo } from 'react';
import { MarkdownBlock, parseTranscript } from '../lectures/TranscriptView';

// Renders the small Markdown subset the AI services return (headings, lists,
// **bold**) as React elements — never as HTML — with per-block text direction
// so Arabic answers read right to left. Single line breaks are kept.
export default function MarkdownText({ text, compact = false, className = '' }) {
  const blocks = useMemo(() => parseTranscript(text, { breaks: true }), [text]);
  const spacing = compact
    ? '[&_p]:mb-2 [&_ul]:mb-2 [&_ol]:mb-2 [&_h3]:mt-3 [&_h4]:mt-3 [&_h5]:mt-3 [&_h3]:text-base [&_h4]:text-base [&_h3]:mb-1.5 [&_h4]:mb-1.5 [&>*:last-child]:mb-0'
    : '';
  return (
    <div className={`whitespace-pre-line ${spacing} ${className}`}>
      {blocks.map((block, index) => <MarkdownBlock key={index} block={block} />)}
    </div>
  );
}
