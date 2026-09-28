const configured=()=>process.env.ORAL_EXAM_ENABLED==='true'&&['GROQ_API_KEY','ELEVENLABS_API_KEY','ELEVENLABS_EN_VOICE_ID','ELEVENLABS_AR_VOICE_ID'].every(key=>Boolean(process.env[key]?.trim()));
module.exports={configured};
