const {test}=require('node:test');
const assert=require('node:assert/strict');
const legacy=require('../src/oralExam/legacy');
test('legacy detection is based on persisted policy markers, never current configuration',()=>{
  assert.equal(legacy.isLegacy({context:{},core_evaluation:null}),true);
  for(const session of [{context:{oral_policy:{version:1}}},{context:{core_plan:[{name:'Routing'}]}},{core_evaluation:{version:1}}])assert.equal(legacy.isLegacy(session),false);
});
test('legacy projection preserves valid persisted values without accepting invented version-1 coverage',()=>{
  const saved={score:84,understanding:86,accuracy:82,completeness:80,communication:90,strengths:['Strength'],areasForImprovement:['Improvement'],topicsCovered:['Routing'],summary:'Original summary'};
  const result=legacy.report({evaluation:{...saved,version:1,required_concepts:5,bonus_score:5}});
  assert.deepEqual(result,{...saved,version:0,legacy:true});
});
