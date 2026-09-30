// The resume key lets this browser tab reclaim its own Oral Exam connection
// after a transport drop, even when the page is refreshed while the server
// still holds the orphaned connection's lease.
//
// - sessionStorage keeps the key, and its attempt counter, across a refresh of the same tab only.
// - A Web Lock named after the key is held for the page's lifetime. A duplicated
//   tab inherits sessionStorage but cannot take the lock while the original tab
//   is alive, so it gets a fresh key and stays a separate owner.
// - Without Web Locks a stored key cannot be told apart from a duplicate, so a
//   fresh key is used, exactly as before this feature.
const PREFIX='oral-exam-resume:';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// On refresh the previous document releases its lock during unload; give it a moment.
const RELOAD_WAIT_MS=1500;

const read=sessionId=>{try{const key=sessionStorage.getItem(PREFIX+sessionId);return UUID.test(key||'')?key:null;}catch{return null;}};
const write=(sessionId,key)=>{try{sessionStorage.setItem(PREFIX+sessionId,key);}catch{/* Private mode: the key lives in memory only. */}};

function hold(key,waitMs){
  return new Promise(resolve=>{
    let release;const held=new Promise(r=>{release=r;});
    let options={ifAvailable:true};
    if(waitMs&&typeof AbortSignal?.timeout==='function')options={signal:AbortSignal.timeout(waitMs)};
    navigator.locks.request(PREFIX+key,options,lock=>{
      if(!lock){resolve(null);return undefined;}
      resolve(release);return held;
    }).catch(()=>resolve(null));
  });
}

// Returns {key, ready, release}. `key` is set immediately when no verification is
// needed; otherwise `ready` resolves with the key once the lock is held.
export function claimResumeKey(sessionId){
  const locks=typeof navigator!=='undefined'&&navigator.locks?.request?navigator.locks:null;
  if(!locks){const key=crypto.randomUUID();return {key,ready:Promise.resolve(key),release:()=>{}};}
  const claim={key:null,released:false,unlock:null};
  claim.release=()=>{claim.released=true;claim.unlock?.();claim.unlock=null;};
  claim.ready=(async()=>{
    const stored=read(sessionId);
    let unlock=stored?await hold(stored,RELOAD_WAIT_MS):null,key=stored;
    if(!unlock){key=crypto.randomUUID();unlock=await hold(key,0);}
    // Remember the key for a refresh of this tab only.
    write(sessionId,key);
    if(claim.released)unlock?.();else claim.unlock=unlock;
    claim.key=key;return key;
  })();
  return claim;
}

// The server accepts a reclaim only from a strictly newer attempt of the same key,
// so attempt numbers must keep increasing across a refresh of this tab too.
const ATTEMPT=':attempt';
const memoryAttempts=new Map();
export function nextResumeAttempt(sessionId){
  const name=PREFIX+sessionId+ATTEMPT;
  let stored=0;
  try{stored=Number(sessionStorage.getItem(name))||0;}catch{/* Storage unavailable: count in memory. */}
  // Memory is only used when storage fails, so a failed write never repeats a number.
  const next=Math.max(stored,memoryAttempts.get(name)||0)+1;
  try{sessionStorage.setItem(name,String(next));}catch{memoryAttempts.set(name,next);}
  return next;
}

export function forgetResumeKey(sessionId){try{sessionStorage.removeItem(PREFIX+sessionId);sessionStorage.removeItem(PREFIX+sessionId+ATTEMPT);}catch{/* Nothing stored. */}}
