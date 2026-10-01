const { z } = require('zod');
const sentence = z.string().trim().min(1).max(1200);
const score = z.number().int().min(0).max(100);
const assessment = z.object({ understanding:score, accuracy:score, completeness:score, communication:score,
  feedback:sentence, strengths:z.array(sentence).max(5), improvements:z.array(sentence).max(5) }).strict();
const question = z.object({ question:z.string().trim().min(5).max(600), concept:z.string().min(1).max(160),
  question_type:z.enum(['initial','follow_up','next_topic','bonus']), difficulty:z.enum(['foundation','application','analysis']),
  citations:z.array(z.string().min(1).max(80)).min(1).max(6), follow_up_reason:z.string().max(300) }).strict();
// What the student's latest utterance was: an answer attempt, or a
// conversational request that must not be scored or advance the exam.
const intent = z.enum(['answer','repeat','clarify','dont_know','unclear']);
const decision = z.object({ intent, reply:z.string().trim().max(400).nullable(), assessment:assessment.nullable(), next:question.nullable(),
  transition:z.string().trim().max(240).nullable().default(null),
  core_concepts:z.array(z.object({name:z.string().trim().min(1).max(160),citations:z.array(z.string().min(1).max(80)).min(1).max(6)}).strict()).min(1).max(8).nullable().default(null),
}).strict();
const commentary=z.object({strengths:z.array(sentence).max(8),areasForImprovement:z.array(sentence).max(8),summary:sentence}).strict();
const evaluation = z.object({ understanding:score, accuracy:score, completeness:score, communication:score,
  strengths:z.array(sentence).max(8), areasForImprovement:z.array(sentence).max(8),
  topicsCovered:z.array(z.string().max(160)).max(40), summary:sentence }).strict();
// Generate provider contracts from the same Zod definitions used after decoding.
// Groq strict mode requires every object property and closed nested objects.
const providerSchema = contract => {
  const schema=z.toJSONSchema(contract);
  delete schema.$schema;
  return schema;
};
const decisionJsonSchema=providerSchema(decision);
const evaluationJsonSchema=providerSchema(evaluation);
const commentaryJsonSchema=providerSchema(commentary);
const id = z.string().uuid();
const createInput = z.object({ language:z.enum(['en','ar']).default('en'), source:z.discriminatedUnion('kind',[
  z.object({kind:z.literal('lecture'),id}).strict(),
  z.object({kind:z.literal('transcript'),id:z.string().min(1).max(200)}).strict(),
  z.object({kind:z.literal('text'),title:z.string().trim().min(1).max(160),text:z.string().trim().min(100).max(90000)}).strict(),
]) }).strict();
const weightedScore = (value) => Math.round(value.understanding*.35+value.accuracy*.35+value.completeness*.2+value.communication*.1);
const fail = (statusCode,message) => { throw Object.assign(new Error(message),{statusCode}); };
module.exports = { assessment,question,intent,decision,evaluation,commentary,commentaryJsonSchema,decisionJsonSchema,evaluationJsonSchema,providerSchema,id,createInput,weightedScore,fail };
