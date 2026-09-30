// Internal adapter pinned to word-extractor 1.0.4. Run only in the bounded
// ingestion worker. Reject encrypted documents and VBA before reading text.
const WordOleExtractor=require('word-extractor/lib/word-ole-extractor');
const BufferReader=require('word-extractor/lib/buffer-reader');
class TextOnlyExtractor extends WordOleExtractor {
  extractWordDocument(document,buffer) {
    if(buffer.length<512||(buffer.readUInt16LE(10)&0x8100))throw new Error('Protected Word document');
    if(document._directoryTree._entries.some(entry=>/^(Macros|VBA|_VBA_PROJECT|_VBA_PROJECT_CUR)$/i.test(entry.name)))throw new Error('Macro-enabled Word document');
    return super.extractWordDocument(document,buffer);
  }
}
module.exports=async buffer=>{
  // Bound allocations derived from the untrusted OLE header before the parser
  // allocates sector tables. Cyclic chains remain bounded by the worker budget.
  if(buffer.length<512||![9,12].includes(buffer.readUInt16LE(30))||buffer.readUInt16LE(32)!==6)throw new Error('Invalid Word container');
  const sectors=Math.floor(buffer.length/(2**buffer.readUInt16LE(30)));
  for(const offset of [44,64,72])if(buffer.readUInt32LE(offset)>sectors)throw new Error('Invalid Word sector count');
  const reader=new BufferReader(buffer);
  try {await reader.open();return (await new TextOnlyExtractor().extract(reader)).getBody();}
  finally{await reader.close();}
};
