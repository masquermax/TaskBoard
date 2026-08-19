import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionEvaluator, GoalState } from '../src/governance/completion-evaluator.js';

function wholeGoalTask(instruction='完成 A + B + C') {
  return {id:'T-proof',requirementSources:[{id:'REQ-T-proof-0001',text:instruction}],taskContract:{obligations:[{id:'OBL-T-proof-GOAL',certification:'supported',requirementRefs:[{sourceId:'REQ-T-proof-0001',start:0,end:instruction.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}}]}};
}
function confirmed(statement,obligationRefs=[]){return{id:'C-A',statement,level:'confirmed',evidenceIds:['E-A'],scope:'general',coverage:'component',hops:[],obligationRefs};}
function evaluate(task,claims,finalResult='done'){return new CompletionEvaluator().evaluate({task,proposal:{finalResult},certifiedContext:{claims,gaps:[]}});}

test('Requirement wording and proposal text cannot manufacture a missing Root completion relation',()=>{
  const task=wholeGoalTask('完成 A');
  assert.equal(evaluate(task,[confirmed('A 已完成')],'Root says everything is done').goalState,GoalState.UNSATISFIED);
  assert.equal(evaluate(wholeGoalTask('修复登录失败'),[],'已经修复完成').goalState,GoalState.UNSATISFIED);
});

test('explicit CONFIRMED whole-goal mapping is sufficient for deterministic completion',()=>{
  const task=wholeGoalTask(),result=evaluate(task,[confirmed('A+B+C 已完成',['OBL-T-proof-GOAL'])],'全部完成');
  assert.equal(result.goalState,GoalState.SATISFIED);
  assert.deepEqual(result.assessments[0].proofFactRefs,['C-A']);
});

test('CompletionEvaluator does not reinterpret Root semantics after provenance certification',()=>{
  const task=wholeGoalTask(),result=evaluate(task,[confirmed('A 已完成',['OBL-T-proof-GOAL'])],'全部完成');
  assert.equal(result.goalState,GoalState.SATISFIED,'semantic adequacy of the mapped Claim is Root-owned; completion only checks explicit mapping');
});
