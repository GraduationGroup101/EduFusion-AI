const { z } = require('zod');
const sentence = z.string().trim().min(1).max(1200);
const score = z.number().int().min(0).max(100);
const assessment = z.object({ understanding:score, accuracy:score, completeness:score, communication:score,
  feedback:sentence, strengths:z.array(sentence).max(5), improvements:z.array(sentence).max(5) }).strict();
const question = z.object({ question:z.string().trim().min(5).max(600), concept:z.string().min(1).max(160),
  question_type:z.enum(['initial','follow_up','next_topic']), difficulty:z.enum(['foundation','application','analysis']),
  citations:z.array(z.string().min(1).max(80)).min(1).max(6), follow_up_reason:z.string().max(300) }).strict();
const decision = z.object({ assessment:assessment.nullable(), next:question.nullable() }).strict();
const evaluation = z.object({ understanding:score, accuracy:score, completeness:score, communication:score,
  strengths:z.array(sentence).max(8), areasForImprovement:z.array(sentence).max(8),
  topicsCovered:z.array(z.string().max(160)).max(40), summary:sentence }).strict();
const id = z.string().uuid();
const createInput = z.object({ language:z.enum(['en','ar']).default('en'), source:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('lecture'),id}).strict(),
  z.object({kind:z.literal('transcript'),id:z.string().min(1).max(200)}).strict(),
  z.object({kind:z.literal('text'),title:z.string().trim().min(1).max(160),text:z.string().trim().min(100).max(90000)}).strict(),
]) }).strict();
const weightedScore = (value) => Math.round(value.understanding*.4+value.accuracy*.3+value.completeness*.2+value.communication*.1);
const fail = (statusCode,message) => { throw Object.assign(new Error(message),{statusCode}); };
module.exports = { assessment,question,decision,evaluation,id,createInput,weightedScore,fail };
