/* eslint-disable no-control-regex -- binary signatures and control-character stripping are intentional */
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
const { openZip, ArchiveError } = require('./zip');

// Oral Exam study-material ingestion. Files are validated by extension, reported
// MIME type and content signature, then converted to normalized plain text inside
// a worker thread with memory and time limits. No macros, scripts or embedded
// objects are ever executed; only text runs are read.
const LIMITS = { maxBytes: 4 * 1024 * 1024, maxPages: 200, maxSlides: 300, maxChars: 90000, minChars: 100, timeoutMs: 25000 };
const FORMATS = {
  txt: { label: 'Text', mimes: ['text/plain'] },
  md: { label: 'Markdown', mimes: ['text/markdown', 'text/x-markdown', 'text/plain'] },
  markdown: { label: 'Markdown', mimes: ['text/markdown', 'text/x-markdown', 'text/plain'] },
  pdf: { label: 'PDF', mimes: ['application/pdf', 'application/x-pdf'] },
  doc: { label: 'Word', mimes: ['application/msword', 'application/vnd.ms-word'] },
  docx: { label: 'Word', mimes: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  pptx: { label: 'PowerPoint', mimes: ['application/vnd.openxmlformats-officedocument.presentationml.presentation'] },
};
// Browsers send an empty or generic type for many files, so those never count as a mismatch.
const GENERIC_MIMES = ['', 'application/octet-stream', 'binary/octet-stream'];
const SUPPORTED = 'Upload a PDF, Word (.doc or .docx), PowerPoint (.pptx), Markdown or plain-text file.';
const IMAGE_MESSAGE = 'Images and photos of notes are not supported yet because EduFusion cannot read text from images (OCR). Paste the text or upload a document with selectable text.';
const UNSUPPORTED = [
  [['ppt', 'dot', 'pps', 'pot'], 'Older PowerPoint and Office templates are not supported. Save the file as .docx, .pptx or PDF, then upload it again.'],
  [['docm', 'pptm', 'dotm', 'potm', 'ppsm', 'xlsm'], 'Macro-enabled Office files are not accepted. Save a copy as .docx or .pptx and upload that instead.'],
  [['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff', 'heic', 'heif', 'svg'], IMAGE_MESSAGE],
  [['xls', 'xlsx', 'csv', 'ods'], 'Spreadsheets are not supported as exam material. Paste the relevant notes as text instead.'],
  [['rtf', 'odt', 'odp', 'pages', 'key', 'epub'], 'This document format is not supported. Save it as PDF or .docx and upload it again.'],
  [['mp3', 'wav', 'm4a', 'mp4', 'mov', 'webm', 'mkv'], 'Audio and video are not accepted here. Process a recording with LectureScribe first, then choose it as a saved lecture.'],
  [['zip', 'rar', '7z', 'tar', 'gz'], 'Compressed archives are not accepted. Upload the document itself.'],
];

class IngestError extends Error {
  constructor(statusCode, code, message) { super(message); this.statusCode = statusCode; this.code = code; }
}
const reject = (statusCode, code, message) => { throw new IngestError(statusCode, code, message); };

function sniff(buffer) {
  const ascii = buffer.subarray(0, 16).toString('latin1');
  if (buffer.subarray(0, 1024).toString('latin1').includes('%PDF-')) return 'pdf';
  if (ascii.startsWith('PK\u0003\u0004') || ascii.startsWith('PK\u0005\u0006')) return 'zip';
  if (ascii.startsWith('\u00d0\u00cf\u0011\u00e0\u00a1\u00b1\u001a\u00e1')) return 'ole';
  if (/^(\u0089PNG|GIF8|\u00ff\u00d8\u00ff|BM|II\*\u0000|MM\u0000\*)/.test(ascii) || (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') || /^....ftyp(heic|heix|mif1|avif)/.test(ascii)) return 'image';
  const magic = buffer.length >= 4 ? buffer.readUInt32BE(0) : 0;
  if (/^(MZ|\u007fELF|#!)/.test(ascii) || [0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(magic)) return 'executable';
  if (/^(Rar!|7z\u00bc\u00af|\u001f\u008b)/.test(ascii)) return 'archive';
  if (/^(ID3|OggS|fLaC|\u001aE\u00df\u00a3)/.test(ascii) || /^....ftyp/.test(ascii)) return 'media';
  return null;
}

// Validates the upload envelope before any parser sees the bytes.
function validate({ name, type, buffer }) {
  const fileName = String(name || '').split(/[\\/]/).pop().trim();
  if (!fileName || fileName.length > 255) reject(400, 'invalid_name', 'The file needs a name.');
  if (!buffer.length) reject(422, 'empty', 'This file is empty.');
  if (buffer.length > LIMITS.maxBytes) reject(413, 'too_large', `This file is larger than ${LIMITS.maxBytes / 1024 / 1024} MB. Upload a smaller file or only the chapters you need.`);
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(fileName)?.[1] || '').toLowerCase();
  const signature = sniff(buffer);
  if (signature === 'executable') reject(415, 'executable', 'Programs and scripts cannot be used as study material. ' + SUPPORTED);
  const format = FORMATS[extension];
  if (!format) {
    const known = UNSUPPORTED.find(([list]) => list.includes(extension));
    reject(415, 'unsupported_type', known ? known[1] : `${extension ? `.${extension} files are` : 'Files without an extension are'} not supported. ${SUPPORTED}`);
  }
  const mime = String(type || '').split(';')[0].trim().toLowerCase();
  if (!GENERIC_MIMES.includes(mime) && !format.mimes.includes(mime)) reject(415, 'type_mismatch', `This file is labelled ${mime}, which does not match its .${extension} name. ${SUPPORTED}`);
  const expected = extension === 'doc' ? 'ole' : extension === 'pdf' ? 'pdf' : ['docx', 'pptx'].includes(extension) ? 'zip' : null;
  if (signature !== expected) {
    if (signature === 'ole') reject(415, 'legacy_or_protected', `This .${extension} file is an older Office format or is password-protected. Save it as an unprotected .docx, .pptx or PDF and try again.`);
    if (signature === 'image') reject(415, 'image', IMAGE_MESSAGE);
    reject(415, 'signature_mismatch', `This file's contents do not match its .${extension} name. It may be renamed or damaged. ${SUPPORTED}`);
  }
  return { fileName, extension, format };
}

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decodeXml = (text) => text.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (match, code) => {
  if (code[0] !== '#') return ENTITIES[code.toLowerCase()] ?? match;
  const point = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '';
});

// Reads relationship targets so part order and locations come from the package, not guesses.
function relationships(zip, part) {
  const slash = part.lastIndexOf('/'), dir = part.slice(0, slash + 1);
  const xml = zip.read(`${dir}_rels/${part.slice(slash + 1)}.rels`) || '';
  const map = new Map();
  for (const [tag] of xml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(tag)?.[1], target = /\bTarget="([^"]+)"/.exec(tag)?.[1], type = /\bType="([^"]+)"/.exec(tag)?.[1] || '';
    if (!id || !target || /TargetMode="External"/.test(tag)) continue;
    const resolved = [];
    for (const segment of (target.startsWith('/') ? target.slice(1) : dir + target).split('/')) {
      if (segment === '..') resolved.pop();
      else if (segment && segment !== '.') resolved.push(segment);
    }
    map.set(id, { target: resolved.join('/'), type });
  }
  return map;
}
const mainPart = (zip, fallback) => [...relationships(zip, '').values()].find((r) => r.type.endsWith('/officeDocument'))?.target || fallback;

function docx(zip) {
  if (!zip.has('[Content_Types].xml')) reject(422, 'malformed', 'This Word file is damaged or incomplete. Open it in Word, save it again and retry.');
  const xml = zip.read(mainPart(zip, 'word/document.xml'));
  if (!xml || !/<w:body\b/.test(xml)) reject(422, 'malformed', 'This file does not contain a Word document body. Open it in Word, save it as .docx and retry.');
  const body = xml.replace(/<w:(del|instrText)\b[^>]*>[\s\S]*?<\/w:\1>/g, '');
  const lines = [];
  for (const [paragraph] of body.matchAll(/<w:p\b[^>]*?(?:\/>|>[\s\S]*?<\/w:p>)/g)) {
    let text = '';
    for (const [token, run] of paragraph.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:(?:br|cr)\b[^>]*\/>/g)) text += run !== undefined ? decodeXml(run) : token.startsWith('<w:tab') ? ' ' : '\n';
    if (!text.trim()) continue;
    const style = /<w:pStyle w:val="([^"]+)"/.exec(paragraph)?.[1] || '';
    const heading = /^title$/i.test(style) ? 1 : Number(/^heading\s?([1-6])$/i.exec(style)?.[1] || 0);
    const level = Number(/<w:ilvl w:val="(\d+)"/.exec(paragraph)?.[1] || 0);
    if (heading) lines.push('', `${'#'.repeat(heading)} ${text.trim()}`, '');
    else if (/<w:numPr\b/.test(paragraph) || /list/i.test(style)) lines.push(`${'  '.repeat(Math.min(level, 4))}- ${text.trim()}`);
    else lines.push('', text.trim(), '');
  }
  return { text: lines.join('\n'), units: null };
}

const PAGE_NUMBER = /^((page|p\.|slide)\s*)?\d{1,4}(\s*(of|\/)\s*\d{1,4})?$/i;
const BULLET = /^(?:[•▪◦‣●○■□➢➤►▶✓✔]\s*|[-–]\s+)/u;
// Returns a predicate for short lines repeated across most pages or slides:
// running headers, footers and copyright lines. Numbers are masked when comparing,
// so "9-2 Copyright" and "9-3 Copyright" count as the same footer. Full sentences
// are never treated as boilerplate, except legal notices.
function boilerplate(groups) {
  const key = (line) => line.replace(/^[\d\s\-–.:/|]+|[\d\s\-–.:/|]+$/g, '').replace(/\d+/g, '#').toLowerCase();
  const candidate = (line) => line.length < 90 && (!/[.?!;:]$/.test(line) || /©|copyright|all rights reserved|confidential/i.test(line));
  const seen = new Map();
  for (const lines of groups) for (const k of new Set(lines.filter(candidate).map(key))) seen.set(k, (seen.get(k) || 0) + 1);
  return (line) => groups.length >= 3 && candidate(line) && seen.get(key(line)) > groups.length * 0.6;
}

// Footer, date and slide-number placeholders are layout metadata, not content.
const stripShapes = (xml) => xml.replace(/<p:sp\b[\s\S]*?<\/p:sp>/g, (shape) => /<p:ph\b[^>]*type="(sldNum|dt|ftr|hdr|sldImg)"/.test(shape) ? '' : shape);
function paragraphs(xml) {
  const result = [];
  for (const [paragraph] of xml.matchAll(/<a:p\b[^>]*?(?:\/>|>[\s\S]*?<\/a:p>)/g)) {
    let text = '';
    for (const [, run] of paragraph.matchAll(/<a:t(?:\s[^>]*)?>([^<]*)<\/a:t>|<a:br\b[^>]*\/>/g)) text += run !== undefined ? decodeXml(run) : ' ';
    if (text.trim()) result.push({ text: text.trim(), level: Number(/<a:pPr\b[^>]*\blvl="(\d+)"/.exec(paragraph)?.[1] || 0) });
  }
  return result;
}
function pptx(zip) {
  const main = mainPart(zip, 'ppt/presentation.xml'), xml = zip.read(main);
  if (!xml || !/<p:presentation\b/.test(xml)) reject(422, 'malformed', 'This file does not contain a PowerPoint presentation. Open it in PowerPoint, save it as .pptx and retry.');
  const rels = relationships(zip, main);
  const slides = [...xml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map(([, id]) => rels.get(id)?.target).filter(Boolean);
  if (!slides.length) reject(422, 'empty', 'This presentation has no slides.');
  if (slides.length > LIMITS.maxSlides) reject(422, 'too_many_slides', `This presentation has ${slides.length} slides. The limit is ${LIMITS.maxSlides}; upload a shorter deck.`);
  const parsed = slides.map((part) => {
    const slide = stripShapes(zip.read(part) || '');
    const titleShape = [...slide.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map(([s]) => s).find((s) => /<p:ph\b[^>]*type="(title|ctrTitle)"/.test(s));
    const title = titleShape ? paragraphs(titleShape).map((p) => p.text).join(' ') : '';
    const body = paragraphs(titleShape ? slide.replace(titleShape, '') : slide).map((p) => ({ ...p, text: p.text.replace(BULLET, '') })).filter((p) => p.text);
    const notesPart = [...relationships(zip, part).values()].find((r) => r.type.endsWith('/notesSlide'))?.target;
    const notes = notesPart ? paragraphs(stripShapes(zip.read(notesPart) || '')).map((p) => p.text).filter((t) => !PAGE_NUMBER.test(t)) : [];
    return { title, body, notes };
  });
  // Decks exported from PDF often repeat a copyright or course line on every slide
  // as plain text boxes instead of footer placeholders.
  const repeated = boilerplate(parsed.map((s) => s.body.map((p) => p.text)));
  const blocks = parsed.map(({ title, body, notes }, index) => {
    const content = body.filter((p) => !repeated(p.text) && !PAGE_NUMBER.test(p.text));
    // Without a title placeholder, a short leading line is the slide's heading.
    if (!title && content.length > 1 && content[0].text.length <= 80 && !/[.?!;,]$/.test(content[0].text)) title = content.shift().text;
    const lines = [`## Slide ${index + 1}${title ? `: ${title}` : ''}`];
    for (const p of content) lines.push(`${'  '.repeat(Math.min(p.level, 4))}- ${p.text}`);
    if (notes.length) lines.push('', `Speaker notes: ${notes.join(' ')}`);
    return lines.join('\n');
  });
  return { text: blocks.join('\n\n'), units: { kind: 'slide', count: slides.length } };
}

async function pdf(buffer) {
  const { getDocumentProxy } = require('unpdf');
  let document;
  try {
    document = await getDocumentProxy(new Uint8Array(buffer), { isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false, verbosity: 0 });
  } catch (error) {
    if (error?.name === 'PasswordException') reject(422, 'protected', 'This PDF is password-protected. Remove the password and upload it again.');
    reject(422, 'malformed', 'This PDF could not be read. It may be damaged; try exporting it again.');
  }
  try {
    const count = document.numPages;
    if (count > LIMITS.maxPages) reject(422, 'too_many_pages', `This PDF has ${count} pages. The limit is ${LIMITS.maxPages}; upload only the chapters you need.`);
    const pages = [];
    for (let number = 1; number <= count; number++) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      let text = '', lastY = null, lastHeight = 0;
      for (const item of content.items) {
        if (typeof item.str !== 'string') continue;
        const y = item.transform?.[5];
        // A vertical jump well beyond one line height marks a paragraph break.
        if (lastY !== null && y !== undefined && Math.abs(lastY - y) > Math.max(lastHeight, item.height || 0) * 1.8 && text && !text.endsWith('\n\n')) text += text.endsWith('\n') ? '\n' : '\n\n';
        else if (lastY !== null && y !== undefined && Math.abs(lastY - y) > 1 && text && !text.endsWith('\n')) text += '\n';
        text += item.str + (item.hasEOL ? '\n' : '');
        if (y !== undefined) { lastY = y; lastHeight = item.height || lastHeight; }
      }
      pages.push(text.split('\n').map((line) => line.trim()));
      page.cleanup();
    }
    // Only the top and bottom lines of a page can be running headers or footers.
    const edges = (lines) => { const filled = lines.filter(Boolean); return [...filled.slice(0, 2), ...filled.slice(-2)]; };
    const repeated = boilerplate(pages.map(edges));
    const text = pages.map((lines, i) => { const edge = new Set(edges(lines)); return `[Page ${i + 1}]\n${lines.filter((l) => !(edge.has(l) && repeated(l)) && !PAGE_NUMBER.test(l)).join('\n')}`; }).join('\n\n');
    // A page has selectable text when anything but page numbers and repeated
    // headers survives. Sparse decks with a few words per page are fine; only a
    // document whose pages are mostly image-only is treated as scanned. Overall
    // length is judged by the shared minimum-characters check afterwards.
    const textual = pages.filter((lines) => { const edge = new Set(edges(lines)); return lines.some((l) => /[\p{L}\p{N}]/u.test(l) && !(edge.has(l) && repeated(l)) && !PAGE_NUMBER.test(l)); }).length;
    if (textual < Math.ceil(count / 2)) reject(422, 'scanned', 'This PDF looks like scanned pages or images, so there is no selectable text to read. EduFusion does not run OCR yet. Upload a PDF with selectable text, or paste the text.');
    return { text, units: { kind: 'page', count } };
  } finally { await document.loadingTask.destroy(); }
}

function plain(buffer) {
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { reject(422, 'encoding', 'This text file is not UTF-8. Save it with UTF-8 encoding and upload it again.'); }
  if (text.includes('\u0000')) reject(422, 'binary', 'This file contains binary data rather than text. ' + SUPPORTED);
  return { text, units: null };
}

function normalize(text) {
  return text.normalize('NFC').replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u00AD\u200B\u2060\uFEFF]/g, '')
    .split('\n').map((line) => {
      const indent = /^ */.exec(line)[0].slice(0, 8);
      return indent + line.trimStart().replace(/[ \t\u00A0\u2000-\u200A\u3000]+/g, ' ').trimEnd();
    })
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Material longer than the exam limit is cut only at a page, slide or paragraph
// boundary, and the response reports exactly what was kept.
function applyLimit(text, units) {
  if (text.length <= LIMITS.maxChars) return { text, truncation: null };
  const head = text.slice(0, LIMITS.maxChars);
  const marker = units ? head.lastIndexOf(units.kind === 'page' ? '\n\n[Page ' : '\n\n## Slide ') : -1;
  const paragraph = head.lastIndexOf('\n\n');
  const cut = marker > LIMITS.maxChars * 0.5 ? marker : paragraph > LIMITS.maxChars * 0.5 ? paragraph : LIMITS.maxChars;
  const kept = text.slice(0, cut).trim();
  const pattern = units?.kind === 'page' ? /\[Page (\d+)\]/g : /## Slide (\d+)/g;
  const last = units ? Math.max(0, ...[...kept.matchAll(pattern)].map((m) => Number(m[1]))) : 0;
  return { text: kept, truncation: {
    kept_characters: kept.length, original_characters: text.length,
    kept_units: units && last ? { kind: units.kind, from: 1, to: last, of: units.count } : null,
  } };
}

async function extractMaterial({ name, type, buffer }) {
  const { fileName, extension, format } = validate({ name, type, buffer });
  let raw;
  try {
    if(extension==='doc') {
      // A parser reads OLE text streams only; Office/macros are never launched.
      try {raw={text:await require('./doc')(buffer),units:null};}
      catch {reject(422,'malformed','This Word file is damaged, encrypted or unsupported. Save an unprotected copy and retry.');}
    } else raw = extension === 'pdf' ? await pdf(buffer) : extension === 'docx' ? docx(openZip(buffer)) : extension === 'pptx' ? pptx(openZip(buffer)) : plain(buffer);
  } catch (error) {
    if (error instanceof ArchiveError) reject(422, 'malformed', `This ${format.label} file is damaged, encrypted or unusually compressed, so it was not opened. Save it again and retry.`);
    throw error;
  }
  const text = normalize(raw.text);
  const readable = text.replace(/^(\[Page \d+\]|## Slide \d+:?)$/gm, '').replace(/\s/g, '');
  if (!readable.length) reject(422, 'empty', `No readable text was found in this ${format.label} file.`);
  if (readable.length < LIMITS.minChars || !/\p{L}/u.test(readable)) reject(422, 'too_short', `This file has only ${readable.length} readable characters. The exam needs at least ${LIMITS.minChars}; add more material or paste notes instead.`);
  const { text: kept, truncation } = applyLimit(text, raw.units);
  const title = fileName.replace(/\.[^.]+$/, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'Uploaded material';
  return { title, text: kept, format: extension === 'markdown' ? 'md' : extension, format_label: format.label, file_name: fileName, file_size: buffer.length, characters: kept.length, units: raw.units, truncation };
}

// Parsing runs in a disposable worker: a pathological file can exhaust only the
// worker's heap or time budget, never the API process.
function extractInWorker(file, limits = LIMITS) {
  return new Promise((resolve, fail) => {
    const worker = new Worker(__filename, { workerData: { oralExamIngest: true, file }, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 48 } });
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); worker.terminate(); fn(value); };
    const timer = setTimeout(() => finish(fail, new IngestError(422, 'timeout', 'This file took too long to process. Try a smaller file or only the chapters you need.')), limits.timeoutMs);
    worker.once('message', (message) => {
      if (message.ok) return finish(resolve, message.material);
      const { statusCode, code, message: text } = message.error;
      finish(fail, statusCode ? new IngestError(statusCode, code, text) : Object.assign(new Error('Extraction failed'), { code: 'extract_failed', detail: text }));
    });
    worker.once('error', (error) => finish(fail, error?.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new IngestError(422, 'too_complex', 'This file is too complex to process. Try a smaller file or only the chapters you need.') : error));
    worker.once('exit', () => finish(fail, new Error('Extraction worker exited')));
  });
}

if (!isMainThread && workerData?.oralExamIngest) {
  const { file } = workerData;
  extractMaterial({ ...file, buffer: Buffer.from(file.buffer) })
    .then((material) => parentPort.postMessage({ ok: true, material }))
    .catch((error) => parentPort.postMessage({ ok: false, error: { statusCode: error instanceof IngestError ? error.statusCode : 0, code: error.code, message: error.message } }));
}

module.exports = { LIMITS, IngestError, extractMaterial, extractInWorker, normalize, sniff, validate };
