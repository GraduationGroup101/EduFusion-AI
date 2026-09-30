const { deflateRawSync, crc32 } = require('node:zlib');

// Builds small but structurally real study documents for ingestion tests.
function zip(files, { store = false } = {}) {
  const locals = [], central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), packed = store ? data : deflateRawSync(data), nameBytes = Buffer.from(name);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(store ? 0 : 8, 8);
    header.writeUInt32LE(crc32(data), 14); header.writeUInt32LE(packed.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(nameBytes.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(store ? 0 : 8, 10);
    entry.writeUInt32LE(crc32(data), 16); entry.writeUInt32LE(packed.length, 20); entry.writeUInt32LE(data.length, 24); entry.writeUInt16LE(nameBytes.length, 28); entry.writeUInt32LE(offset, 42);
    locals.push(header, nameBytes, packed); central.push(entry, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length / 2, 8); end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function docx(blocks) {
  const body = blocks.map(({ style, list, text }) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr><w:r><w:t xml:space="preserve">${escape(text)}</w:t></w:r></w:p>`).join('');
  return zip({
    '[Content_Types].xml': '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    '_rels/.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="${REL}/extended-properties" Target="docProps/app.xml"/></Relationships>`,
    'docProps/core.xml': '<cp:coreProperties><dc:creator>Secret Author Metadata</dc:creator></cp:coreProperties>',
    'word/document.xml': `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}<w:sectPr/></w:body></w:document>`,
  });
}

function pptx(slides) {
  const shapes = (slide) => `<p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>${escape(slide.title)}</a:t></a:r></a:p></p:txBody></p:sp>`
    + `<p:sp><p:nvSpPr><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr><p:txBody>${slide.bullets.map((b) => `<a:p><a:r><a:t>${escape(b)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp>`
    + '<p:sp><p:nvSpPr><p:nvPr><p:ph type="sldNum"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>99</a:t></a:r></a:p></p:txBody></p:sp>';
  // Slide parts are deliberately numbered out of presentation order.
  const parts = slides.map((_, i) => slides.length - i);
  const files = {
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    '_rels/.rels': `<Relationships><Relationship Id="rId1" Type="${REL}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`,
    'ppt/presentation.xml': `<p:presentation><p:sldIdLst>${slides.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 10}"/>`).join('')}</p:sldIdLst></p:presentation>`,
    'ppt/_rels/presentation.xml.rels': `<Relationships>${slides.map((_, i) => `<Relationship Id="rId${i + 10}" Type="${REL}/slide" Target="slides/slide${parts[i]}.xml"/>`).join('')}</Relationships>`,
  };
  slides.forEach((slide, i) => {
    files[`ppt/slides/slide${parts[i]}.xml`] = `<p:sld><p:cSld><p:spTree>${shapes(slide)}</p:spTree></p:cSld></p:sld>`;
    if (slide.notes) {
      files[`ppt/slides/_rels/slide${parts[i]}.xml.rels`] = `<Relationships><Relationship Id="rId1" Type="${REL}/notesSlide" Target="../notesSlides/notesSlide${parts[i]}.xml"/></Relationships>`;
      files[`ppt/notesSlides/notesSlide${parts[i]}.xml`] = `<p:notes><p:sp><p:txBody><a:p><a:r><a:t>${escape(slide.notes)}</a:t></a:r></a:p></p:txBody></p:sp></p:notes>`;
    }
  });
  return zip(files);
}

// A minimal multi-page PDF with real text operators and a correct xref table.
function pdf(pages) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', null, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  for (const lines of pages) {
    const stream = lines.length ? `BT /F1 12 Tf 72 720 Td 16 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) Tj T*`).join(' ')} ET` : '';
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${objects.length} 0 R >>`);
    kids.push(`${objects.length} 0 R`);
  }
  objects[1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${kids.length} >>`;
  let out = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => { const at = Buffer.byteLength(out); out += `${i + 1} 0 obj\n${body}\nendobj\n`; return at; });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

module.exports = { zip, docx, pptx, pdf };
