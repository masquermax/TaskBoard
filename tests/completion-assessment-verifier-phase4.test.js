import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionAssessmentVerifier } from '../src/governance/completion-assessment-verifier.js';
import { CompletionEvaluator, GoalState } from '../src/governance/completion-evaluator.js';

function task(){
  const text='检查 A、B 并给出完整结论';
  return{
    id:'T-1',
    requirementSources:[{id:'REQ-T-1-0001',text}],
    taskContract:{obligations:[
      {id:'A',certification:'supported',requirementRefs:[{sourceId:'REQ-T-1-0001',start:0,end:text.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}},
      {id:'B',certification:'supported',requirementRefs:[{sourceId:'REQ-T-1-0001',start:0,end:text.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}},
    ]},
  };
}
function claim(id,evidenceId,obligationRefs=[]){
  return{id,statement:`${id} 已完成`,level:'confirmed',evidenceIds:[evidenceId],scope:'general',coverage:'component',hops:[],obligationRefs};
}
function certifiedContext(claims){return{claims,gaps:[]};}

test('Completion assessment consumes Root-owned obligation mapping and CompletionEvaluator remains the only aggregator',async()=>{
  const verifier=new CompletionAssessmentVerifier();
  const result=await verifier.review({
    task:task(),
    proposal:{finalResult:'只完成 A',summary:'A done'},
    certifiedContext:certifiedContext([claim('C-A','E-A',['A'])]),
  });
  assert.equal(result.assessments.length,2);
  const a=result.assessments.find(x=>x.obligationRefs[0]==='A');
  assert.equal(a.certification,'supported');
  assert.equal(a.proofKind,'completion_obligation_support');
  assert.equal(a.criterionSatisfied,true);
  assert.deepEqual(a.proofFactRefs,['C-A']);
  assert.equal(result.assessments.find(x=>x.obligationRefs[0]==='B').certification,'unresolved');

  const evaluated=new CompletionEvaluator().evaluate({taskContract:task().taskContract,certifiedAssessments:result.assessments});
  assert.equal(evaluated.goalState,GoalState.UNSATISFIED);
  assert.deepEqual(evaluated.unsatisfiedObligationIds,['B']);
});

test('Multi-obligation completion is deterministic when Root maps confirmed Claims to every obligation',async()=>{
  const verifier=new CompletionAssessmentVerifier({executor:{async runValidator(){throw new Error('MODEL_MUST_NOT_RUN');}}});
  const result=await verifier.review({
    task:task(),
    proposal:{finalResult:'A、B 已完成',summary:'done'},
    certifiedContext:certifiedContext([
      claim('C-A','E-A',['A']),
      claim('C-B','E-B',['B']),
    ]),
  });
  assert.equal(result.assessments.every(item=>item.certification==='supported'),true);
  const evaluated=new CompletionEvaluator().evaluate({taskContract:task().taskContract,certifiedAssessments:result.assessments});
  assert.equal(evaluated.goalState,GoalState.SATISFIED);
  assert.deepEqual(evaluated.satisfiedObligationIds,['A','B']);
});

test('Single canonical goal obligation remains compatible with existing confirmed Claims while Root migration adds obligationRefs',async()=>{
  const text='完成当前目标';
  const single={
    id:'T-2',
    requirementSources:[{id:'REQ-T-2-0001',text}],
    taskContract:{obligations:[{id:'OBL-T-2-GOAL',certification:'supported',requirementRefs:[{sourceId:'REQ-T-2-0001',start:0,end:text.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}}]},
  };
  const verifier=new CompletionAssessmentVerifier();
  const result=await verifier.review({task:single,proposal:{finalResult:'done'},certifiedContext:certifiedContext([claim('C-1','E-1')])});
  assert.equal(result.assessments[0].certification,'supported');
});

test('SUPPORTED inference is never promoted into completion proof',async()=>{
  const context={claims:[{id:'C-I',statement:'推理结论',level:'supported',evidenceIds:['E-I'],scope:'general',coverage:'component',hops:[],obligationRefs:['A']}],gaps:[]};
  const result=await new CompletionAssessmentVerifier().review({task:task(),proposal:{finalResult:'完成'},certifiedContext:context});
  assert.equal(result.assessments.every(item=>item.certification==='unresolved'),true);
});
