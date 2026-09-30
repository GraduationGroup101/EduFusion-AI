/* eslint-disable no-control-regex -- binary signatures and control-character stripping are intentional */
const { inflateRawSync } = require('node:zlib');

// A read-only ZIP reader for Office Open XML packages. Nothing is written to disk
// and nothing is executed: named XML parts are inflated into memory under hard
// limits so a zip bomb or malformed archive fails fast instead of exhausting memory.
const LIMITS = { maxEntries: 3000, maxEntryBytes: 16 * 1024 * 1024, maxTotalBytes: 48 * 1024 * 1024, maxRatio: 200 };

class ArchiveError extends Error {}
const bad = (message) => { throw new ArchiveError(message); };

function findEnd(buffer) {
  const floor = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= floor; i--) if (buffer.readUInt32LE(i) === 0x06054b50) return i;
  return bad('No ZIP directory');
}

function safeName(name) {
  // Entry names are only used as lookup keys, but traversal-shaped names mean a hostile archive.
  if (!name || /[\\\u0000]/.test(name) || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..')) bad('Unsafe entry name');
  return name;
}

function openZip(buffer, limits = LIMITS) {
  if (buffer.length < 22 || buffer.readUInt32LE(0) !== 0x04034b50) bad('Not a ZIP archive');
  const end = findEnd(buffer);
  const count = buffer.readUInt16LE(end + 10), size = buffer.readUInt32LE(end + 12), start = buffer.readUInt32LE(end + 16);
  if (count === 0xffff || start === 0xffffffff) bad('ZIP64 archives are not supported');
  if (count > limits.maxEntries) bad('Too many entries');
  if (start + size > end) bad('Corrupt ZIP directory');
  const entries = new Map();
  let at = start, declaredTotal = 0;
  for (let n = 0; n < count; n++) {
    if (at + 46 > end || buffer.readUInt32LE(at) !== 0x02014b50) bad('Corrupt ZIP directory');
    const flags = buffer.readUInt16LE(at + 8), method = buffer.readUInt16LE(at + 10);
    const compressed = buffer.readUInt32LE(at + 20), uncompressed = buffer.readUInt32LE(at + 24);
    const nameLength = buffer.readUInt16LE(at + 28), extra = buffer.readUInt16LE(at + 30), comment = buffer.readUInt16LE(at + 32);
    const offset = buffer.readUInt32LE(at + 42);
    const name = safeName(buffer.toString('utf8', at + 46, at + 46 + nameLength));
    if (flags & 1) bad('Encrypted entries are not supported');
    declaredTotal += uncompressed;
    if (declaredTotal > limits.maxTotalBytes * 4) bad('Archive expands too far');
    entries.set(name, { method, compressed, uncompressed, offset });
    at += 46 + nameLength + extra + comment;
  }
  let inflated = 0;
  return {
    has: (name) => entries.has(name),
    names: () => [...entries.keys()],
    read(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      const { method, compressed, uncompressed, offset } = entry;
      if (uncompressed > limits.maxEntryBytes) bad('Entry too large');
      if (uncompressed > 1024 * 1024 && uncompressed / Math.max(1, compressed) > limits.maxRatio) bad('Suspicious compression ratio');
      if (offset + 30 > buffer.length || buffer.readUInt32LE(offset) !== 0x04034b50) bad('Corrupt local header');
      const dataStart = offset + 30 + buffer.readUInt16LE(offset + 26) + buffer.readUInt16LE(offset + 28);
      if (dataStart + compressed > buffer.length) bad('Truncated entry');
      const raw = buffer.subarray(dataStart, dataStart + compressed);
      let data;
      if (method === 0) data = raw;
      else if (method === 8) {
        try { data = inflateRawSync(raw, { maxOutputLength: Math.max(1, uncompressed) }); }
        catch { bad('Corrupt compressed entry'); }
      } else bad('Unsupported compression');
      // The declared size bounds inflation; a mismatch means the directory lied.
      if (data.length !== uncompressed) bad('Entry size mismatch');
      inflated += data.length;
      if (inflated > limits.maxTotalBytes) bad('Archive expands too far');
      return data.toString('utf8');
    },
  };
}
module.exports = { openZip, ArchiveError, LIMITS };
