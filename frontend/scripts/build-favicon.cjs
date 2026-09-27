// Build the existing Vite favicon from the approved, tightly cropped symbol only.
// Requires ffmpeg on PATH; no full logo, background fill or recoloring is involved.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const brand = path.resolve(__dirname, '../public/brand');
const sizes = [16, 32, 48];
const images = sizes.map(size => {
  const result = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(brand, 'edufusion-mark-alpha.png'),
    '-vf', `format=gbrap,premultiply=inplace=1,scale=${size}:${size}:force_original_aspect_ratio=decrease:flags=lanczos,unpremultiply=inplace=1,format=rgba,pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
    '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'png', '-'], { maxBuffer: 1024 * 1024 });
  if (result.status !== 0) throw new Error(result.stderr.toString());
  return result.stdout;
});
// ICO directory entries embed each size's lossless RGBA PNG directly.
const directory = Buffer.alloc(6 + sizes.length * 16);
directory.writeUInt16LE(1, 2); directory.writeUInt16LE(sizes.length, 4);
let offset = directory.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  directory[entry] = size; directory[entry + 1] = size;
  directory.writeUInt16LE(1, entry + 4); directory.writeUInt16LE(32, entry + 6);
  directory.writeUInt32LE(images[index].length, entry + 8); directory.writeUInt32LE(offset, entry + 12);
  offset += images[index].length;
});
const target = path.join(brand, 'edufusion-symbol-v2.ico');
fs.writeFileSync(target, Buffer.concat([directory, ...images]));
console.log(`Wrote ${path.basename(target)}: ${sizes.join(', ')}px transparent symbol frames`);
