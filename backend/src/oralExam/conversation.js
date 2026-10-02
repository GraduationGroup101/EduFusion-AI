// Conversational intent for oral-exam turns.
//
// A committed transcript is not always an answer. Obvious control phrases in
// English and Arabic ("repeat the question", "عيد السؤال", "I don't know",
// "ما بعرف") are recognised here deterministically, without a model call.
// Anything longer or ambiguous is classified by the examiner model as part of
// its structured decision. Both paths feed the same limits so a student cannot
// stall the exam indefinitely, and neither path ever reveals an answer.

const INTENTS=['answer','repeat','clarify','dont_know','unclear'];
// Exchange kinds stored on a turn, one per non-answer intent.
const KIND={repeat:'repeat',clarify:'clarification',dont_know:'nudge',unclear:'retry'};
const LIMITS={repeat:2,clarification:1,nudge:1,retry:2,total:4};
const MAX_CONTROL_WORDS=14;

const ARABIC_MARKS=/[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
function normalize(text) {
  return String(text||'').toLowerCase()
    .replace(ARABIC_MARKS,'')
    .replace(/[أإآٱ]/g,'ا').replace(/ة/g,'ه').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي')
    .replace(/[’‘`]/g,"'")
    .replace(/[^\p{L}\p{N}'\s]/gu,' ')
    .replace(/\s+/g,' ').trim();
}
const words=text=>text?text.split(' ').filter(Boolean):[];

// Order matters: a student who says "I don't understand, repeat it" wants a
// clarification, and "I don't know what you mean" is a clarification too.
const PATTERNS={
  clarify:[
    /^(\S+ ){0,3}(i )?(don'?t|do not|didn'?t|did not|can'?t|cannot|couldn'?t|could not) (understand|get|follow)\b/,
    /\bwhat (do|did) you mean\b/, /\bwhat does (that|this|the question|it) mean\b/, /\bwhat are you asking\b/, /\bwhat is the question\b/,
    /\b(explain|clarify|rephrase|simplify|reword)\b/, /\bnot clear\b/, /\bunclear\b/, /\bconfus(ed|ing)\b/, /\bmake (it|that) (simpler|clearer)\b/,
    /(^|\s)(مش|مو|ما|لست|لم|ماني|مانيش) ?(فاهم|فاهمه|فهمت|افهم|بفهم|فهمتش)(\s|$)/, /(^|\s)(مافهمت|مفهمتش|مافهمتش|مش فاهم)(\s|$)/,
    /(^|\s)(وضح|توضح|وضحي|اشرح|تشرح|اشرحي|بسط|تبسط|فسر|اعد صياغه|اعد صياغة|صياغه اخرى)(\s|$)/,
    /(يعني|شو|ايش|ايه|ماذا|ما) (قصدك|تقصد|معناه|معنى|المقصود)/, /(قصدك|تقصد) (ايه|شو|ايش|ماذا)/, /(مش|مو|غير) واضح/,
    /(^|\s)يعني (ايه|ايش|شو|ماذا)(\s|$)/, /(^|\s)(ايه|ايش|شو|ماذا) (يعني|المقصود|السؤال)(\s|$)/,
  ],
  repeat:[
    /\brepeat\b/, /\bsay (that|it|the question) again\b/, /\b(once|one) more time\b/, /\bagain please\b/, /^again$/, /\bcome again\b/, /^(pardon|sorry)( me)?$/,
    /\b(didn'?t|did not|couldn'?t|could not|can'?t|cannot) hear\b/, /\bi missed (that|it|the question)\b/,
    /(^|\s)(عيد|اعيد|تعيد|اعد|عيدي|كرر|تكرر|كرري|اعاده|اعادة|رجع|رجعي|ارجع)(\s|$)/, /مره (ثانيه|تانيه|اخرى|كمان|ثانية)/, /(ما|لم|مش|مو) سمعت/, /سمعتش|ماسمعت|ما سمعتك/,
  ],
  dont_know:[
    /^(\S+ ){0,2}(i )?(don'?t|do not) know\b/, /^(\S+ ){0,2}(i )?(don'?t|do not) remember\b/, /\bno idea\b/, /\bno clue\b/, /^(\S+ ){0,2}(i'?m |i am )?not sure\b/,
    /^(\S+ ){0,2}i (forgot|forget)\b/, /^(\S+ ){0,2}(can'?t|cannot) remember\b/, /^(\S+ ){0,2}(skip|pass)( (this|it|that)( one| question)?| the question)?$/, /\bnext question\b/,
    /^(\S+ ){0,2}(ما|لا|مش|مو|لم|ماني) ?(بعرف|اعرف|عارف|عارفه|ادري|بدري|اعلم|عرفت)(\s|$)/, /(^|\s)(مابعرف|معرفش|مااعرف|ماعرف|مدري|ماادري|معرفتش|مابدري)(\s|$)/,
    /^(\S+ ){0,2}(نسيت|ناسي|ناسيه)(\s|$)/, /^(\S+ ){0,2}(ما|لا|مش|مو) ?(اتذكر|بتذكر|متذكر|متذكره|متاكد|متاكده)(\s|$)/, /(^|\s)(تخطي|تجاوز|السؤال (التالي|الجاي|اللي بعده))(\s|$)/,
  ],
};
// Vocal fillers only; real words such as "يعني" (means) or "ايه" (what) stay
// words so "يعني ايه؟" is a clarification, not noise.
const FILLER=/^(um+|uh+|hmm+|mm+|er+|ah+|eh+|oh+|huh|اه+|امم+|ام+|هم+|اا+|اممم|هاه)$/;

// Returns a control intent, 'unclear', or null when the utterance looks like
// an answer attempt (or is too long to judge without the model).
function classify(transcript) {
  const normalized=normalize(transcript);
  const tokens=words(normalized);
  if(!tokens.length||!/[\p{L}]/u.test(normalized)||tokens.every(t=>FILLER.test(t)))return 'unclear';
  if(tokens.length===1&&tokens[0].length<=2)return 'unclear';
  if(tokens.length>MAX_CONTROL_WORDS)return null;
  for(const intent of ['clarify','repeat','dont_know'])if(PATTERNS[intent].some(pattern=>pattern.test(normalized)))return intent;
  return null;
}

// Safeguard: each question allows a bounded number of non-answer exchanges.
// Past the limit the student gets one gentle nudge, and after that whatever
// they say is treated as their answer so the exam always progresses.
function resolve(intent,exchanges=[]) {
  if(!intent||!INTENTS.includes(intent)||intent==='answer')return 'answer';
  const count=kind=>exchanges.filter(e=>e.kind===kind).length;
  const kind=KIND[intent];
  if(exchanges.length<LIMITS.total&&count(kind)<LIMITS[kind])return intent;
  if(intent!=='dont_know'&&exchanges.length<LIMITS.total&&count('nudge')<LIMITS.nudge)return 'dont_know';
  return 'answer';
}

const REPLIES={
  en:{
    repeat:'Of course. Here is the question again.',
    retry:'I did not catch that clearly. Please say your answer again.',
    clarification:question=>`Let me put the question another way. ${question}`,
    nudge:'That is okay. Take a moment and tell me whatever you remember about this topic, even a part of it.',
  },
  ar:{
    repeat:'بالتأكيد. إليك السؤال مرة أخرى.',
    retry:'لم أسمع إجابتك بوضوح. من فضلك أعد إجابتك.',
    clarification:question=>`دعني أصيغ السؤال بطريقة أخرى. ${question}`,
    nudge:'لا بأس. خذ لحظة وأخبرني بما تتذكره عن هذا الموضوع، ولو جزءاً منه.',
  },
};
// Text the examiner speaks for a non-answer exchange. Model replies are used
// for clarifications and nudges when available; everything else is fixed.
function reply(intent,language,question,modelReply=null) {
  const set=REPLIES[language]||REPLIES.en;
  const kind=KIND[intent];
  if(kind==='clarification')return modelReply||set.clarification(question);
  if(kind==='nudge')return modelReply||set.nudge;
  return set[kind];
}
// What the student hears: the question is re-read after a repeat; a
// clarification is itself a rephrasing, so it stands alone.
const spoken=(kind,text,question)=>kind==='repeat'?`${text} ${question}`:text;
const CLOSINGS={en:'That brings us to the end of the interview. Thank you, and best of luck.',ar:'هيك بنكون وصلنا لنهاية المقابلة. شكرًا إلك وبالتوفيق.'};
const closing=language=>CLOSINGS[language]||CLOSINGS.en;
// Acknowledgements may vary, but only use content-neutral vocabulary. Unknown
// words fail closed, so paraphrased subject answers cannot bypass quote checks.
const TRANSITION_WORDS={
  en:new Set("i you your you've we we'll let's let us that that's this it it's the a an and but so to on in of from with for at as is was are be have has can could thank thanks good clear clearly identified explained described shared expressed main idea point part answer response understanding start useful thoughtful helpful partial almost one important missing more much some further another different angle perspective approach look explore focus consider continue move next now together briefly try build expand take step well okay right track direction clarify develop deepen reflect about into quite not yet let's keep going".split(' ')),
  ar:new Set(normalize('أنا أنت إنت انتِ إحنا نحن خلينا نكمل من زاوية ثانية تانية أخرى شكرا إلك لك تمام كويس جيد جيدًا منيح ممتاز فهمت قصدك الفكرة الأساسية واضحة وضحت وصلت عبرت عن فكرتك إجابتك جوابك على الطريق الصحيح بس لسه في جزء مهم ناقص دعنا نركز عليه نفكر فيها بطريقة مختلفة ننتقل للخطوة التالية نستكشف أكثر شوي هلا الآن هذا هذه هيك مع بعض نقطة بداية مفيدة حاول نطور نفهم بعمق السؤال القادم').split(' ')),
};
function safeTransition(text,evidence,question,language){
  if(!text||text.length>240||/[0-9٠-٩%?؟:]/u.test(text)||text.split(/[.!。]/).filter(s=>s.trim()).length>1)return false;
  if(/\b(score|grade|rubric|correct answer|expected answer|because|therefore|reasoning|evidence|means|defined as)\b|درجتك|علامتك|الإجابة الصحيحة|الاجابة الصحيحة|لأن|لان|دليل|معيار/iu.test(text))return false;
  if(language==='ar'&&!/[\u0600-\u06ff]/.test(text))return false;
  if(language==='en'&&/[\u0600-\u06ff]/.test(text))return false;
  if(words(normalize(text)).some(word=>!(TRANSITION_WORDS[language]||TRANSITION_WORDS.en).has(word)))return false;
  return !leaks(text,evidence,question);
}

// A clarification or nudge must not quote the material it is examining.
// Two rules: any eight consecutive words of evidence, or any three consecutive
// evidence words that the question itself does not contain (so a short exact
// answer such as "consulting its routing table" is caught, while restating
// the question's own words is allowed). Trigrams made only of function words
// are ignored.
const STOPWORDS=new Set(['the','a','an','of','in','on','to','and','or','is','are','it','its','this','that','for','by','with','as','at','be','do','does','what','which','how','why','you','your','we','they','من','في','على','و','او','هو','هي','هذا','هذه','ما','ماذا','كيف','لماذا','التي','الذي','عن','الى','ان','هل']);
const grams=(value,size)=>{const w=words(normalize(value));const set=new Set();for(let i=0;i+size<=w.length;i++)set.add(w.slice(i,i+size).join(' '));return set;};
function leaks(text,chunks,question='') {
  const long=grams(text,8);
  if(long.size&&chunks.some(chunk=>[...grams(chunk.text,8)].some(gram=>long.has(gram))))return true;
  const allowed=grams(question,3);
  const short=[...grams(text,3)].filter(gram=>!allowed.has(gram)&&gram.split(' ').some(token=>!STOPWORDS.has(token)));
  if(!short.length)return false;
  return chunks.some(chunk=>{const evidence=grams(chunk.text,3);return short.some(gram=>evidence.has(gram));});
}

module.exports={INTENTS,KIND,LIMITS,normalize,classify,resolve,reply,spoken,leaks,closing,safeTransition};
