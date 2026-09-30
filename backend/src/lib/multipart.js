const { badRequest } = require('./validation');

// Buffers a multipart body with a hard byte ceiling, then parses it with the
// platform FormData parser. Only the listed fields are accepted, once each.
async function readMultipart(req, { maxBytes, fields, tooLarge }) {
  const type = req.headers['content-type'] || '';
  if (!/^multipart\/form-data;\s*boundary=/i.test(type)) throw badRequest('multipart/form-data is required');
  const oversized = () => Object.assign(new Error(tooLarge), { statusCode: 413 });
  if (Number(req.headers['content-length']) > maxBytes) { req.resume(); throw oversized(); }
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw oversized();
      chunks.push(chunk);
    }
  } catch (error) { req.resume(); throw error; }
  let form;
  try { form = await new Response(Buffer.concat(chunks), { headers: { 'Content-Type': type } }).formData(); }
  catch { throw badRequest('Invalid multipart data'); }
  for (const key of form.keys()) if (!fields.includes(key) || form.getAll(key).length !== 1) throw badRequest('Invalid upload field');
  return form;
}
module.exports = { readMultipart };
