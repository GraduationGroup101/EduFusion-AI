import { useId, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlignLeft, Copy, Download, Sparkles } from 'lucide-react';

// Letters only: Arabic diacritics and Arabic-Indic digits do not count towards the ratio.
const ARABIC_LETTERS = /[\u0621-\u064A\u066E-\u06D3\u06FA-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFC]/g;
const LATIN_LETTERS = /[A-Za-z\u00C0-\u024F]/g;
const RTL_LANGUAGES = new Set(['ar', 'fa', 'ur', 'he', 'ps', 'sd', 'ug', 'yi', 'dv']);
// Short or letter-less blocks find their own direction from their first strong character.
const BIDI = { unicodeBidi: 'plaintext', textAlign: 'start' };
const START = { textAlign: 'start' };
// DM Sans has no Arabic glyphs: list Arabic-capable faces after it so Latin stays on brand.
const FONT_STACK = '"DM Sans", "Noto Naskh Arabic", "Noto Sans Arabic", "Segoe UI", Tahoma, "Geeza Pro", Arial, sans-serif';

const letterCounts = (text) => {
  const value = String(text || '');
  return { arabic: (value.match(ARABIC_LETTERS) || []).length, latin: (value.match(LATIN_LETTERS) || []).length };
};
export const arabicRatio = (text) => {
  const { arabic, latin } = letterCounts(text);
  return arabic + latin ? arabic / (arabic + latin) : 0;
};
// Same rule as the server: too little text to judge returns null.
export const detectTextLanguage = (text) => {
  const { arabic, latin } = letterCounts(text);
  if (arabic + latin < 20) return null;
  return arabic / (arabic + latin) >= 0.3 ? 'ar' : 'en';
};
// Each block takes the direction of its main script. "dir=auto" alone looks only at the
// first strong character, which turns an Arabic sentence that opens with "TCP" left-to-right.
const blockDirection = (text) => {
  const { arabic, latin } = letterCounts(text);
  if (arabic + latin < 3) return 'auto';
  return arabic / (arabic + latin) >= 0.3 ? 'rtl' : 'ltr';
};
const bidiProps = (text) => {
  const dir = blockDirection(text);
  return { dir, style: dir === 'auto' ? BIDI : START };
};
const languageCode = (value) => {
  const code = String(value || '').trim().toLowerCase();
  return /^[a-z]{2}$/.test(code) ? code : null;
};

// Older formatted transcripts can start with a model preamble or end with a model note.
// Like LectureScribe's own cleaner, only a line that talks about the transcript itself
// is removed, so lecture speech that ends with a colon ("Here is today's agenda:") stays.
const PREAMBLE = new RegExp('^(?:\\*\\*)?(?:'
  + "(?:here(?:'s| is| are)|below (?:is|are))\\b.{0,80}?\\b(?:transcript|text|chunk|version)\\b.{0,40}?:"
  + '|(?:cleaned|edited|corrected|copy-edited|formatted|revised) (?:transcript|text|chunk)(?:\\*\\*)?\\s*:?'
  // \u0625\u0644\u064A\u0643 / \u0627\u0644\u064A\u0643 / \u0625\u0644\u064A\u0643\u0645 / \u0627\u0644\u064A\u0643\u0645 / \u0641\u064A\u0645\u0627 \u064A\u0644\u064A / \u0647\u0630\u0627 \u0647\u0648 / \u0647\u0630\u0647 \u0647\u064A ... \u0627\u0644\u0646\u0635 / \u0627\u0644\u062A\u0641\u0631\u064A\u063A / \u0627\u0644\u0646\u0633\u062E\u0629
  + '|(?:\u0625\u0644\u064A\u0643|\u0627\u0644\u064A\u0643|\u0625\u0644\u064A\u0643\u0645|\u0627\u0644\u064A\u0643\u0645|\u0641\u064A\u0645\u0627 \u064A\u0644\u064A|\u0647\u0630\u0627 \u0647\u0648|\u0647\u0630\u0647 \u0647\u064A)'
  + '.{0,80}?(?:\u0627\u0644\u0646\u0635|\u0627\u0644\u062A\u0641\u0631\u064A\u063A|\u0627\u0644\u0646\u0633\u062E\u0629)(?![\u0621-\u064A]).{0,40}?:'
  + ')(?:\\*\\*)?\\s*$', 'i');
// A note about the model's own edits ("Note: I have kept the technical terms\u2026"), not the lecturer's.
const MODEL_NOTE = /^\(?\s*(?:\*\*)?note(?:\*\*)?\s*:\s*(?:\*\*)?\s*i(?:'ve| have)?\s+(?:kept|preserved|retained|removed|corrected|formatted|cleaned|translated|left)\b/i;
const MODEL_NOTE_MAX = 300;
export const stripModelWrapper = (text) => {
  const paragraphs = String(text || '').replace(/\r\n?/g, '\n').trim().split(/\n\s*\n/);
  if (paragraphs.length && PREAMBLE.test(paragraphs[0].split('\n')[0].trim())) {
    const rest = paragraphs[0].split('\n').slice(1).join('\n').trim();
    if (rest) paragraphs[0] = rest; else paragraphs.shift();
  }
  // Only a short one-line closing note is dropped: a longer paragraph is lecture content.
  const last = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1].trim() : '';
  if (last && !last.includes('\n') && last.length <= MODEL_NOTE_MAX && MODEL_NOTE.test(last)) paragraphs.pop();
  return paragraphs.join('\n\n').trim();
};

// A closing "#" sequence must follow whitespace, so "## Programming in C#" keeps its "#".
const HEADING = /^(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/;
const RULE = /^([-*_])(?:\s*\1){2,}$/;
const BULLET = /^\s*[-*+\u2022]\s+(.+)$/;
const NUMBERED = /^\s*([0-9\u0660-\u0669\u06F0-\u06F9]+)[.)]\s+(.+)$/;
const toNumber = (digits) => Number(String(digits).replace(/[\u0660-\u0669]/g, (d) => d.charCodeAt(0) - 0x0660).replace(/[\u06F0-\u06F9]/g, (d) => d.charCodeAt(0) - 0x06F0)) || 1;

/** Parses the Markdown subset LectureScribe produces into plain block objects (never HTML). */
export function parseTranscript(text) {
  const blocks = [];
  let paragraph = [];
  let list = null;
  const flushParagraph = () => { if (paragraph.length) blocks.push({ type: 'p', text: paragraph.join(' ') }); paragraph = []; };
  const flushList = () => { if (list) blocks.push(list); list = null; };
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) { flushParagraph(); flushList(); continue; }
    const heading = HEADING.exec(trimmed);
    if (heading) { flushParagraph(); flushList(); blocks.push({ type: 'h', level: heading[1].length, text: heading[2] }); continue; }
    if (RULE.test(trimmed)) { flushParagraph(); flushList(); blocks.push({ type: 'hr' }); continue; }
    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      if (list?.type !== 'ul') { flushList(); list = { type: 'ul', items: [] }; }
      list.items.push(bullet[1].trim()); continue;
    }
    const numbered = NUMBERED.exec(line);
    if (numbered) {
      flushParagraph();
      if (list?.type !== 'ol') { flushList(); list = { type: 'ol', start: toNumber(numbered[1]), items: [] }; }
      list.items.push(numbered[2].trim()); continue;
    }
    // An indented line continues the previous list item; anything else ends the list.
    if (list && /^\s{2,}/.test(line)) { list.items[list.items.length - 1] += ' ' + trimmed; continue; }
    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph(); flushList();
  return blocks;
}

// Older raw transcripts are a single unbroken paragraph: split long ones by sentence
// (or, for unpunctuated speech, by word budget) so they stay readable.
// A sentence ends at . ! ? ؟ or … (plus closing quotes) followed by whitespace, so "3.5" stays whole.
const SENTENCE_BREAK = /(?<=[.!?\u061F\u2026]["'\u201D\u2019)\]]*)\s+/;
const splitLongParagraph = (paragraph) => {
  if (paragraph.length <= 900) return [paragraph];
  const sentences = paragraph.split(SENTENCE_BREAK).filter(Boolean);
  const groups = [];
  if (sentences.length >= 3) {
    let current = [];
    for (const sentence of sentences) {
      current.push(sentence);
      if (current.length >= 4 || current.join(' ').length >= 600) { groups.push(current.join(' ')); current = []; }
    }
    if (current.length) groups.push(current.join(' '));
    return groups;
  }
  const words = paragraph.split(/\s+/);
  for (let index = 0; index < words.length; index += 90) groups.push(words.slice(index, index + 90).join(' '));
  return groups;
};
export const rawParagraphs = (text) => String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/)
  .map((paragraph) => paragraph.replace(/\s*\n\s*/g, ' ').trim()).filter(Boolean).flatMap(splitLongParagraph);

const renderInline = (text) => {
  const parts = [];
  const bold = /\*\*([^*\n]+?)\*\*/g;
  let last = 0;
  let match;
  while ((match = bold.exec(text))) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<strong key={match.index} className="font-semibold text-light-accent">{match[1]}</strong>);
    last = bold.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
};

const headingClass = ['', 'text-xl md:text-2xl mt-8', 'text-lg md:text-xl mt-7', 'text-base md:text-lg mt-6'];
function Block({ block }) {
  if (block.type === 'hr') return <hr className="my-6 border-border" />;
  if (block.type === 'h') {
    const level = Math.min(block.level, 3);
    const Tag = `h${level + 2}`;
    return <Tag {...bidiProps(block.text)} className={`${headingClass[level]} mb-3 font-semibold leading-snug text-light-accent first:mt-0`}>{renderInline(block.text)}</Tag>;
  }
  if (block.type === 'ul' || block.type === 'ol') {
    const Tag = block.type;
    return <Tag className="mb-5 space-y-2" role="list">
      {block.items.map((item, index) => <li key={index} {...bidiProps(item)} className="flex items-baseline gap-3">
        {block.type === 'ul'
          ? <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 -translate-y-[0.2em] rounded-full bg-secondary/70" />
          : <span aria-hidden="true" className="shrink-0 font-semibold tabular-nums text-secondary">{block.start + index}.</span>}
        <span className="min-w-0 flex-1">{renderInline(item)}</span>
      </li>)}
    </Tag>;
  }
  return <p {...bidiProps(block.text)} className="mb-5 last:mb-0">{renderInline(block.text)}</p>;
}

const countWords = (text) => String(text || '').split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
const fileName = (title, tab, extension) => {
  // eslint-disable-next-line no-control-regex -- control characters are not allowed in file names
  const base = String(title || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'lecture-transcript';
  return `${base}${tab === 'original' ? ' (original)' : ''}.${extension}`;
};
const legacyCopy = (text) => {
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0';
  document.body.appendChild(area); area.select();
  try { return document.execCommand('copy'); } catch { return false; } finally { area.remove(); }
};

const TABS = { formatted: { label: 'Formatted', icon: Sparkles, hint: 'Readable layout with headings and paragraphs, in the lecture’s own language.' },
  original: { label: 'Original', icon: AlignLeft, hint: 'The transcript exactly as it was spoken, with paragraph breaks only.' } };
const button = 'inline-flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-sm text-light-accent/80 hover:border-secondary hover:text-secondary';

/**
 * Reads a lecture transcript: "Formatted" (cleaned Markdown subset) and "Original"
 * (raw speech) tabs, safe rendering without injected HTML, and per-block direction
 * so Arabic, English and mixed lines each align naturally.
 */
export default function TranscriptView({ cleaned, raw, title, language }) {
  const id = useId();
  const formatted = useMemo(() => stripModelWrapper(cleaned), [cleaned]);
  const original = useMemo(() => String(raw || '').trim(), [raw]);
  const tabs = ['formatted', 'original'].filter((key) => (key === 'formatted' ? formatted : original));
  // A legacy formatted copy of an Arabic lecture may have been translated: show the original first.
  const hint = languageCode(language);
  const preferOriginal = hint === 'ar' && formatted && original && arabicRatio(formatted) < 0.1 && arabicRatio(original) >= 0.3;
  const [choice, setChoice] = useState(null);
  const tab = tabs.includes(choice) ? choice : preferOriginal ? 'original' : tabs[0];
  const text = tab === 'formatted' ? formatted : original;
  const blocks = useMemo(() => (tab === 'formatted' ? parseTranscript(text) : rawParagraphs(text).map((paragraph) => ({ type: 'p', text: paragraph }))), [tab, text]);
  const lang = detectTextLanguage(text) || hint;
  const rtl = RTL_LANGUAGES.has(lang);
  const words = useMemo(() => countWords(text), [text]);

  if (!tabs.length) return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-light-accent/60">This transcript is empty.</p>;

  const copy = async () => {
    try { await navigator.clipboard.writeText(text); }
    catch {
      if (!legacyCopy(text)) { toast.error('Copy failed — select the text and copy it manually'); return; }
    }
    toast.success('Transcript copied');
  };
  const download = () => {
    const extension = tab === 'formatted' ? 'md' : 'txt';
    try {
      const url = URL.createObjectURL(new Blob([text], { type: `${extension === 'md' ? 'text/markdown' : 'text/plain'};charset=utf-8` }));
      const link = document.createElement('a');
      link.href = url; link.download = fileName(title, tab, extension);
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { toast.error('Download failed — copy the transcript instead'); }
  };

  return <section aria-label="Transcript" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="tablist" aria-label="Transcript version" className="inline-flex rounded-xl border border-border bg-surface-2 p-1">
        {tabs.map((key) => {
          const { label, icon: Icon } = TABS[key];
          return <button key={key} type="button" role="tab" id={`${id}-${key}`} aria-selected={tab === key} aria-controls={`${id}-panel`}
            onClick={() => setChoice(key)}
            className={`inline-flex items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors ${tab === key ? 'bg-white text-secondary shadow-sm' : 'text-light-accent/60 hover:text-light-accent'}`}>
            <Icon size={15} aria-hidden="true" />{label}
          </button>;
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-light-accent/55 tabular-nums">{words.toLocaleString('en-US')} words</span>
        <button type="button" onClick={copy} className={button}><Copy size={15} aria-hidden="true" />Copy</button>
        <button type="button" onClick={download} className={button}><Download size={15} aria-hidden="true" />Download .{tab === 'formatted' ? 'md' : 'txt'}</button>
      </div>
    </div>
    <p className="text-xs text-light-accent/55">{TABS[tab].hint}</p>
    {preferOriginal && tab === 'original' && <p role="note" className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
      The formatted copy of this older transcript is not in Arabic, so the original-language transcript is shown first.
    </p>}
    <article id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${tab}`} dir={rtl ? 'rtl' : 'ltr'} lang={lang || undefined}
      style={{ fontFamily: FONT_STACK }}
      className={`rounded-xl md:max-h-[70vh] md:overflow-y-auto md:overscroll-contain border border-border bg-white px-4 py-5 text-light-accent md:px-8 md:py-7 ${rtl ? 'text-[17px] leading-[2.05]' : 'text-[15px] leading-8'}`}>
      <div className="mx-auto max-w-3xl">
        {blocks.map((block, index) => <Block key={index} block={block} />)}
      </div>
    </article>
  </section>;
}
