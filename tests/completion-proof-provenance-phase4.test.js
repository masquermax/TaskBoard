import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionAssessmentVerifier } from '../src/governance/completion-assessment-verifier.js';
import { CompletionEvaluator, GoalState } from '../src/governance/completion-evaluator.js';

function wholeGoalTask(instruction='完成 A + B + C') {
  return {
    id:'T-proof',
    requirementSources:[{id:'REQ-T-proof-0001',text:instruction}],
    taskContract:{obligations:[{
      id:'OBL-T-proof-GOAL',
      certification:'supported',
      requirementRefs:[{sourceId:'REQ-T-proof-0001',start:0,end:instruction.length}],
      criterion:{mode:'outcome',acceptedOutcomes:['succeeded']},
    }]},
  };
}
function confirmed(statement,obligationRefs=[]){return{id:'C-A',statement,level:'confirmed',evidenceIds:['E-A'],scope:'general',coverage:'component',hops:[],obligationRefs};}

test('Completion proposal and Requirement wording cannot manufacture a completion relation absent Root mapping',async()=>{
  const task=wholeGoalTask('完成 A');
  const verifier=new CompletionAssessmentVerifier();
  const result=await verifier.review({
    task,
    proposal:{finalResult:'Root says everything is done',summary:'done'},
    certifiedContext:{claims:[confirmed('A 已完成')],gaps:[]},
  });
  assert.equal(result.assessments[0].certification,'unresolved');
  assert.equal(new CompletionEvaluator().evaluate({taskContract:task.taskContract,certifiedAssessments:result.assessments}).goalState,GoalState.UNSATISFIED);
});

test('Root says done with zero confirmed facts cannot manufacture Completion proof',async()=>{
  const task=wholeGoalTask('修复登录失败');
  const verified=await new CompletionAssessmentVerifier().review({task,proposal:{finalResult:'已经修复完成'},certifiedContext:{claims:[],gaps:[]}});
  assert.equal(verified.assessments[0].certification,'unresolved');
  assert.equal(new CompletionEvaluator().evaluate({taskContract:task.taskContract,certifiedAssessments:verified.assessments}).goalState,GoalState.UNSATISFIED);
});

test('Root owns the A+B+C judgment: explicit mapping of a confirmed whole-goal Claim is sufficient for deterministic aggregation',async()=>{
  const task=wholeGoalTask();
  const verified=await new CompletionAssessmentVerifier({executor:{async runValidator(){throw new Error('MODEL_MUST_NOT_RUN');}}}).review({
    task,
    proposal:{finalResult:'全部完成'},
    certifiedContext:{claims:[confirmed('A+B+C 已完成',['OBL-T-proof-GOAL'])],gaps:[]},
  });
  assert.equal(verified.assessments[0].certification,'supported');
  assert.deepEqual(verified.assessments[0].proofFactRefs,['C-A']);
  assert.equal(new CompletionEvaluator().evaluate({taskContract:task.taskContract,certifiedAssessments:verified.assessments}).goalState,GoalState.SATISFIED);
});

test('A partial Claim mapped to the whole goal is still Root judgment, not a Validator reasoning task',async()=>{
  const task=wholeGoalTask();
  let modelCalls=0;
  const verified=await new CompletionAssessmentVerifier({executor:{async runValidator(){modelCalls+=1;}}}).review({
    task,
    proposal:{finalResult:'全部完成'},
    certifiedContext:{claims:[confirmed('A 已完成',['OBL-T-proof-GOAL'])],gaps:[]},
  });
  assert.equal(modelCalls,0);
  assert.equal(verified.assessments[0].certification,'supported');
  assert.match(verified.assessments[0].reason,/Root completion judgment/);
});
