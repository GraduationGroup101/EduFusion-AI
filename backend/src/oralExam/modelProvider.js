// Provider descriptors for the shared OpenAI-compatible chat-completions
// transport in examiner.js. Oral Exam runs on OpenRouter; the lecture tools and
// the academic assistant keep their own Groq connection and key.
const safeCode=value=>typeof value==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(value)?value:undefined;
function describe({name,defaultBaseUrl,baseUrlVar,keyVar,modelVar,defaultModel,reasoning,routing=()=>undefined,attribution=false}) {
  function baseUrl(env=process.env) {
    const configured=baseUrlVar&&env[baseUrlVar]?.trim();
    if(!configured)return defaultBaseUrl;
    try {
      if(['http:','https:'].includes(new URL(configured).protocol))return configured.replace(/\/+$/,'');
    } catch { /* Fall back to the documented provider below. */ }
    console.error(JSON.stringify({event:'oral_exam.model_provider_base_url_rejected',provider:name}));
    return defaultBaseUrl;
  }
  // Optional OpenRouter attribution. It never carries a secret, and a missing or
  // malformed value only omits the header instead of failing the exam.
  function headers(env=process.env) {
    const value={Authorization:`Bearer ${env[keyVar]?.trim()||''}`,'Content-Type':'application/json'};
    if(!attribution)return value;
    const site=env.ORAL_EXAM_APP_URL?.trim();
    if(site&&/^https?:\/\/[\w.-]{1,200}(?::\d{1,5})?(?:\/[\w./-]{0,200})?$/.test(site))value['HTTP-Referer']=site;
    const title=env.ORAL_EXAM_APP_TITLE?.trim()||'EduFusion Oral Exam';
    if(/^[\w .,'()-]{1,64}$/.test(title))value['X-Title']=title;
    return value;
  }
  return {name,defaultBaseUrl,defaultModel,baseUrl,headers,routing,reasoning,
    endpoint:(env=process.env)=>`${baseUrl(env)}/chat/completions`,
    model:(env=process.env)=>env[modelVar]?.trim()||defaultModel};
}
// OpenRouter routing must reach a provider that honours the strict JSON Schema;
// it never silently degrades to one that would ignore response_format.
const oralExam=describe({name:'openrouter',defaultBaseUrl:'https://openrouter.ai/api/v1',baseUrlVar:'ORAL_EXAM_API_BASE_URL',
  keyVar:'ORAL_EXAM_API_KEY',modelVar:'ORAL_EXAM_MODEL',defaultModel:'openai/gpt-oss-120b',
  reasoning:effort=>({reasoning:{effort}}),routing:()=>({require_parameters:true}),attribution:true});
const groq=describe({name:'groq',defaultBaseUrl:'https://api.groq.com/openai/v1',keyVar:'GROQ_API_KEY',
  modelVar:'GROQ_MODEL',defaultModel:'openai/gpt-oss-120b',reasoning:effort=>({reasoning_effort:effort})});
// Numeric rate-limit metadata only. Header names vary between OpenAI-compatible
// providers, so both the generic and the per-resource spellings are accepted.
function rateLimits(responseHeaders,extra={}) {
  const numeric=keys=>{for(const key of keys){const value=responseHeaders.get(key);if(value!==null&&/^\d{1,16}$/.test(value))return Number(value);}return undefined;};
  const value={limit:numeric(['x-ratelimit-limit','x-ratelimit-limit-requests','x-ratelimit-limit-tokens']),
    remaining:numeric(['x-ratelimit-remaining','x-ratelimit-remaining-requests','x-ratelimit-remaining-tokens']),...extra};
  const present=Object.entries(value).filter(([,entry])=>entry!==undefined);
  return present.length?Object.fromEntries(present):undefined;
}
// Retry-After is seconds or an HTTP date. An unreadable value falls back to a
// fixed wait that the caller still bounds against the exam deadline.
function retryAfterMs(responseHeaders,fallbackMs=10000) {
  const value=responseHeaders.get('retry-after');
  if(value===null)return fallbackMs;
  const ms=Number.isFinite(Number(value))?Number(value)*1000:Date.parse(value)-Date.now();
  return Number.isFinite(ms)&&ms>0?ms:fallbackMs;
}
// OpenRouter returns its own normalized error and, for an upstream failure, the
// provider's untrusted body in error.metadata.raw; a provider reached directly
// returns only its own error. Nothing but a safe short code, a requested-token
// count and known contract field names is taken from either, so no provider
// message, raw body or rejected generation reaches the caller.
function failure(status,text,schema) {
  const result={};
  let reported;
  try { reported=JSON.parse(text.slice(0,8192))?.error; } catch { return result; }
  if(!reported||typeof reported!=='object')return result;
  let upstream;
  const raw=reported.metadata?.raw;
  try {
    if(typeof raw==='string')upstream=JSON.parse(raw.slice(0,8192));
    else if(raw&&typeof raw==='object')upstream=raw;
    if(upstream?.error&&typeof upstream.error==='object')upstream=upstream.error;
  } catch { /* Provider body is not trusted diagnostic data. */ }
  // OpenRouter's own `code` is the HTTP status, so a string code comes from the
  // gateway's or the upstream provider's error taxonomy.
  result.code=safeCode(reported.code)||safeCode(reported.type)||safeCode(upstream?.code)||safeCode(upstream?.type);
  for(const message of [reported.message,upstream?.message]) {
    const match=typeof message==='string'&&message.match(/\bRequested[:\s]+(\d{1,9})\b/i);
    if(match){result.requestedTokens=Number(match[1]);break;}
  }
  const generation=[reported.failed_generation,upstream?.failed_generation].find(value=>typeof value==='string'&&value.length<=8192);
  if(status===400&&result.code==='json_validate_failed'&&generation&&Array.isArray(schema?.required)) {
    try {
      const rejected=JSON.parse(generation);
      if(rejected&&typeof rejected==='object'&&!Array.isArray(rejected))result.missingFields=schema.required.filter(key=>!Object.hasOwn(rejected,key));
    } catch { /* A rejected generation need not be parseable JSON. */ }
  }
  return result;
}
module.exports={oralExam,groq,rateLimits,retryAfterMs,failure,safeCode};
