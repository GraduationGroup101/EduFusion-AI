const WebSocket=require('ws');
const providerCodes=new Set(['quota_exceeded','rate_limit_exceeded','too_many_concurrent_requests','system_busy','invalid_api_key','insufficient_permissions','voice_not_found','model_not_found','invalid_request','invalid_request_body','payment_required','subscription_required']);
class SpeechProviderError extends Error {
  constructor(status,code){super('Speech playback unavailable');this.name='SpeechProviderError';this.status=status;this.code=code;}
}
function diagnostic(error){return {error_class:error?.name||'Error',provider:'elevenlabs',provider_status:Number.isInteger(error?.status)?error.status:undefined,
  provider_code:providerCodes.has(error?.code)||['invalid_content_type','invalid_audio','response_too_large'].includes(error?.code)?error.code:undefined};}

// Adapted from Candidexa's composed STT/TTS ports: PCM16 input, a server-only
// ElevenLabs connection, partial/final transcript events, and disposable audio.
function transcriber({language,onPartial,onFinal,onError,signal},{WebSocketImpl=WebSocket}={}) {
  const params=new URLSearchParams({model_id:'scribe_v2_realtime',audio_format:'pcm_16000',language_code:language,commit_strategy:'vad',vad_silence_threshold_secs:'1.5'});
  const socket=new WebSocketImpl(`wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params}`,{headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY},maxPayload:64000,handshakeTimeout:8000});
  let ready=false,closed=false,rejectOpened;
  const deadline=setTimeout(()=>failure(),10000);
  function close() {if(closed)return;closed=true;ready=false;clearTimeout(deadline);signal.removeEventListener('abort',close);rejectOpened?.(new Error('Speech service unavailable'));socket.terminate();}
  function failure() {if(!closed){close();onError();}}
  signal.addEventListener('abort',close,{once:true});
  const opened=new Promise((resolve,reject)=>{
    rejectOpened=reject;
    socket.on('message',raw=>{
      if(closed)return;
      try {
        const msg=JSON.parse(raw.toString());
        if(msg.message_type==='session_started'){ready=true;clearTimeout(deadline);resolve();}
        else if(msg.message_type==='partial_transcript')onPartial(String(msg.text||'').slice(0,8000));
        else if(['committed_transcript','committed_transcript_with_timestamps'].includes(msg.message_type)){
          const text=String(msg.text||'').trim();
          if(text&&text.length<=8000)onFinal(text);
          else if(text.length>8000)failure();
        } else if(/error|exceeded|insufficient|invalid|unauthorized/.test(msg.message_type||'')) {reject(new Error('Speech service unavailable'));failure();}
      } catch {reject(new Error('Speech service unavailable'));failure();}
    });
    socket.on('error',()=>{reject(new Error('Speech service unavailable'));failure();});
    socket.on('close',()=>{reject(new Error('Speech service unavailable'));failure();});
  });
  opened.catch(()=>{});
  if(signal.aborted)close();
  return {opened,close,send(bytes){
    if(!ready||closed)return false;
    if(bytes.length>6400||bytes.length%2||socket.bufferedAmount>128000){failure();return false;}
    socket.send(JSON.stringify({message_type:'input_audio_chunk',audio_base_64:bytes.toString('base64'),sample_rate:16000}),error=>{if(error)failure();});
    return true;
  }};
}
async function speak(text,language,signal,fetchImpl=fetch) {
  const voice=language==='ar'?process.env.ELEVENLABS_AR_VOICE_ID:process.env.ELEVENLABS_EN_VOICE_ID;
  const response=await fetchImpl(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}/stream?output_format=mp3_44100_128`,{
    method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),
    headers:{'xi-api-key':process.env.ELEVENLABS_API_KEY,'Content-Type':'application/json',Accept:'audio/mpeg'},
    body:JSON.stringify({text,language_code:language,model_id:'eleven_flash_v2_5'}),
  });
  if(!response.ok){
    // Read only a bounded error body and retain only a known machine code.
    let code;
    try{let body='';for await(const part of response.body){body+=Buffer.from(part).toString('utf8');if(body.length>8192)break;}
      const detail=JSON.parse(body);const value=detail.detail?.status||detail.error?.code;code=providerCodes.has(value)?value:undefined;
    }catch{/* Never log provider text. */}
    throw new SpeechProviderError(response.status,code);
  }
  if(!response.headers.get('content-type')?.includes('audio/mpeg')){await response.body?.cancel();throw new SpeechProviderError(response.status,'invalid_content_type');}
  const parts=[];let size=0;
  for await(const part of response.body){size+=part.length;if(size>2*1024*1024)throw new SpeechProviderError(response.status,'response_too_large');parts.push(Buffer.from(part));}
  const audio=Buffer.concat(parts);
  if(!(audio.subarray(0,3).toString()==='ID3'||(audio[0]===255&&(audio[1]&224)===224)))throw new SpeechProviderError(response.status,'invalid_audio');
  return audio;
}
module.exports={transcriber,speak,diagnostic};
