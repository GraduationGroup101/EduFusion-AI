/* Ephemeral 16 kHz mono PCM16, in 100 ms frames. No audio is stored. */
class OralExamCapture extends AudioWorkletProcessor {
  constructor(){super();this.samples=new Int16Array(1600);this.offset=0;}
  process(inputs){
    const input=inputs[0]?.[0];
    if(input)for(const sample of input){
      const value=Math.max(-1,Math.min(1,sample));
      this.samples[this.offset++]=Math.round(value*(value<0?32768:32767));
      if(this.offset===1600){this.port.postMessage(this.samples.buffer,[this.samples.buffer]);this.samples=new Int16Array(1600);this.offset=0;}
    }
    return true;
  }
}
registerProcessor('oral-exam-capture',OralExamCapture);
