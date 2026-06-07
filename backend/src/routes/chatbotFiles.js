const express = require('express');
const { PassThrough } = require('stream');
const { authenticate, requireRole } = require('../middleware/auth');

const router = express.Router();

const CHATBOT_BASE = process.env.CHATBOT_API_URL || 'https://iug-chatbot.onrender.com';
const adminOnly = [authenticate, requireRole(['admin', 'advisor'])];

const proxyFetch = async (url, options = {}) => {
  const fetch = (await import('node-fetch')).default;
  return fetch(url, options);
};

const safeJson = async (response) => {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return text || '';
  }
};

const proxyResponse = async (response, res) => {
  const data = await safeJson(response);
  res.status(response.ok ? 200 : response.status).json(data);
};

const createJsonOnlyMultipartStream = (req) => new Promise((resolve, reject) => {
  const passThrough = new PassThrough();
  const bufferedChunks = [];
  let bufferedLength = 0;
  let resolved = false;
  let rejected = false;

  const cleanup = () => {
    req.off('data', onData);
    req.off('end', onEnd);
    req.off('error', onError);
  };

  const rejectUpload = (error) => {
    if (rejected || resolved) return;
    rejected = true;
    cleanup();
    req.unpipe(passThrough);
    passThrough.destroy();
    reject(error);
  };

  const resolveUpload = () => {
    if (resolved || rejected) return;
    resolved = true;
    cleanup();
    for (const chunk of bufferedChunks) {
      passThrough.write(chunk);
    }
    req.pipe(passThrough);
    resolve(passThrough);
  };

  const inspectBufferedHeader = () => {
    const headerText = Buffer.concat(bufferedChunks, bufferedLength).toString('latin1');
    const filenameMatch = headerText.match(/filename="([^"]+)"/i);

    if (filenameMatch) {
      const filename = filenameMatch[1].trim().toLowerCase();
      if (!filename.endsWith('.json')) {
        rejectUpload(new Error('Only .json files are allowed'));
        return;
      }
      resolveUpload();
      return;
    }

    if (bufferedLength > 64 * 1024) {
      rejectUpload(new Error('Could not validate uploaded file name'));
    }
  };

  const onData = (chunk) => {
    bufferedChunks.push(chunk);
    bufferedLength += chunk.length;
    inspectBufferedHeader();
  };

  const onEnd = () => {
    if (!resolved && !rejected) {
      rejectUpload(new Error('No uploaded file was found'));
    }
  };

  const onError = (err) => rejectUpload(err);

  req.on('data', onData);
  req.on('end', onEnd);
  req.on('error', onError);
});

router.post('/upload-file', adminOnly, async (req, res) => {
  try {
    const contentType = req.headers['content-type'];
    if (!contentType?.includes('multipart/form-data')) {
      return res.status(400).json({ error: 'multipart/form-data request is required' });
    }

    const uploadStream = await createJsonOnlyMultipartStream(req);
    const headers = { 'Content-Type': contentType };
    if (req.headers['content-length']) {
      headers['Content-Length'] = req.headers['content-length'];
    }

    const response = await proxyFetch(`${CHATBOT_BASE}/upload-file`, {
      method: 'POST',
      headers,
      body: uploadStream,
    });

    return proxyResponse(response, res);
  } catch (err) {
    console.error('[chatbot-files] upload error:', err.message);
    return res.status(err.message.includes('.json') ? 400 : 503).json({
      error: err.message.includes('.json')
        ? err.message
        : 'Chatbot file upload service is unavailable',
    });
  }
});

router.post('/chat/file', adminOnly, async (req, res) => {
  try {
    const response = await proxyFetch(`${CHATBOT_BASE}/chat/file`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(req.body || {}),
    });

    return proxyResponse(response, res);
  } catch (err) {
    console.error('[chatbot-files] file chat error:', err.message);
    return res.status(503).json({ error: 'Chatbot file chat service is unavailable' });
  }
});

router.get('/files/list', adminOnly, async (req, res) => {
  try {
    const response = await proxyFetch(`${CHATBOT_BASE}/files/list`);
    return proxyResponse(response, res);
  } catch (err) {
    console.error('[chatbot-files] list error:', err.message);
    return res.status(503).json({ error: 'Could not list chatbot files' });
  }
});

router.delete('/files/:collection_name', adminOnly, async (req, res) => {
  try {
    const collectionName = encodeURIComponent(req.params.collection_name);
    const response = await proxyFetch(`${CHATBOT_BASE}/files/${collectionName}`, {
      method: 'DELETE',
    });

    return proxyResponse(response, res);
  } catch (err) {
    console.error('[chatbot-files] delete error:', err.message);
    return res.status(503).json({ error: 'Could not delete chatbot file' });
  }
});

router.post('/files/:collection_name/reload', adminOnly, async (req, res) => {
  try {
    const collectionName = encodeURIComponent(req.params.collection_name);
    const response = await proxyFetch(`${CHATBOT_BASE}/files/${collectionName}/reload`, {
      method: 'POST',
    });

    return proxyResponse(response, res);
  } catch (err) {
    console.error('[chatbot-files] reload error:', err.message);
    return res.status(503).json({ error: 'Could not reload chatbot file' });
  }
});

router.get('/files/:collection_name/chunks', adminOnly, async (req, res) => {
  try {
    const collectionName = encodeURIComponent(req.params.collection_name);
    const response = await proxyFetch(`${CHATBOT_BASE}/files/${collectionName}/chunks`);
    return proxyResponse(response, res);
  } catch (err) {
    console.error('[chatbot-files] chunks error:', err.message);
    return res.status(503).json({ error: 'Could not load chatbot file chunks' });
  }
});

module.exports = router;
