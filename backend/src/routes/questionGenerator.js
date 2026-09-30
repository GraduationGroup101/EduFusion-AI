const express = require('express');
const { authenticate } = require('../middleware/auth');
const { aiLimiter } = require('../middleware/limits');
const { integer, badRequest } = require('../lib/validation');
const { readMultipart } = require('../lib/multipart');
const { requestUpstream, readJson, upstreamStatus, sendError } = require('../lib/upstream');
const router = express.Router();
const BASE=(process.env.QUESTION_GENERATOR_API_URL || 'https://question-generator-api-pol9.onrender.com').replace(/\/+$/,'');
const MAX_UPLOAD_BYTES=4*1024*1024;
router.use(authenticate);
router.get('/health',async(req,res)=>{
  try { const response=await requestUpstream(req,`${BASE}/health`,{},{timeoutMs:20000});res.status(upstreamStatus(response.status)).json(await readJson(response)); }
  catch(error) { sendError(res,error); }
});
const readForm=async(req)=>{
  const form=await readMultipart(req,{maxBytes:MAX_UPLOAD_BYTES,fields:['file','num_mcq','num_tf','num_essay'],tooLarge:'Upload exceeds 4 MB'});
  const file=form.get('file');
  if(!file || typeof file==='string' || !file.size || !/\.(pdf|docx?|txt|pptx?)$/i.test(file.name)) throw badRequest('Choose a nonempty PDF, Word, text or PowerPoint file');
  const result=new FormData();result.append('file',file,file.name);
  let count=0;
  for(const key of ['num_mcq','num_tf','num_essay']){const amount=integer(form.get(key),key,0,50);count+=amount;result.append(key,String(amount));}
  if(!count) throw badRequest('Choose at least one question');
  return result;
};
router.post('/generate',aiLimiter,async(req,res)=>{
  try {
    const body=await readForm(req);
    const response=await requestUpstream(req,`${BASE}/generate`,{method:'POST',body},{timeoutMs:170000});
    res.status(upstreamStatus(response.status)).json(await readJson(response));
  } catch(error) { sendError(res,error,error.statusCode===413?'Upload exceeds 4 MB':'Question generation is temporarily unavailable'); }
});
module.exports=router;
module.exports.readForm=readForm;
