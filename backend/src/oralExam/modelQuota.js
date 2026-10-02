const {setTimeout:delay}=require('node:timers/promises');

// Groq's token headers describe a per-minute bucket, not an exam allowance.
// Waiting for its reset never moves the exam's authoritative deadline.
function duration(value){
  if(typeof value!=='string'||! /^(?:\d+(?:\.\d+)?(?:ms|s|m|h))+$/.test(value))return null;
  return [...value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)].reduce((sum,m)=>sum+Number(m[1])*({ms:1,s:1000,m:60000,h:3600000}[m[2]]),0);
}
function createQuota({now=Date.now,wait=(ms,signal)=>delay(ms,undefined,{signal}),onWait=()=>{}}={}){
  const buckets=new Map();
  const number=(headers,key)=>{const raw=headers.get(key);return raw!==null&&/^\d+$/.test(raw)&&Number(raw)<=1e9?Number(raw):null;};
  function observe(model,headers){
    const limit=number(headers,'x-ratelimit-limit-tokens'),remaining=number(headers,'x-ratelimit-remaining-tokens'),reset=duration(headers.get('x-ratelimit-reset-tokens'));
    if(!limit||remaining===null||reset===null)return;
    const bucket=buckets.get(model)||{tail:Promise.resolve()};
    Object.assign(bucket,{limit,remaining:Math.min(limit,remaining),resetAt:now()+reset});buckets.set(model,bucket);
  }
  async function run(model,body,{signal,expiresAt,check=()=>{}}={},request){
    const bucket=buckets.get(model)||{tail:Promise.resolve()};buckets.set(model,bucket);
    const previous=bucket.tail;let release;bucket.tail=new Promise(resolve=>{release=resolve;});
    try{
      await previous;check();
      // Conservative reservation includes the requested completion budget.
      const estimate=Math.ceil(Buffer.byteLength(body)/3)+JSON.parse(body).max_tokens;
      if(bucket.limit&&now()<bucket.resetAt&&bucket.remaining<Math.min(bucket.limit,estimate)){
        const resetMs=Math.ceil(bucket.resetAt-now()),ms=Math.min(60000,resetMs+250);
        if(resetMs>60000||expiresAt&&now()+ms>=new Date(expiresAt).getTime())throw Object.assign(new Error('Model quota wait exceeds deadline'),{name:'TimeoutError',code:'model_quota_deadline'});
        onWait({model,wait_ms:ms,token_limit:bucket.limit,remaining_tokens:bucket.remaining,estimated_tokens:estimate});
        await wait(ms,signal);check();
      }
      if(bucket.limit){if(now()>=bucket.resetAt)bucket.remaining=bucket.limit;bucket.remaining=Math.max(0,bucket.remaining-estimate);}
      let abort;
      try{
        const pending=request();
        const response=signal?await Promise.race([pending,new Promise((_,reject)=>{abort=()=>reject(signal.reason||new DOMException('Aborted','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();})]):await pending;
        observe(model,response.headers);return response;
      }finally{if(abort)signal.removeEventListener('abort',abort);}
    }finally{release();}
  }
  return {observe,run};
}
module.exports={createQuota,duration};
