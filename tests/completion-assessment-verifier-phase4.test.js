import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionEvaluator, GoalState } from '../src/governance/completion-evaluator.js';

function task(){
  const text='检查 A、B 并给出完整结论';
  return{id:'T-1',requirementSources:[{id:'REQ-T-1-0001',text}],taskContract:{obligations:[
    {id:'A',certification:'supported',requirementRefs:[{sourceId:'REQ-T-1-0001',start:0,end:text.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}},
    {id:'B',certification:'supported',requirementRefs:[{sourceId:'REQ-T-1-0001',start:0,end:text.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}},
  ]}};
}
function claim(id,evidenceId,obligationRefs=[],level='confirmed'){return{id,statement:`${id} 已完成`,level,evidenceIds:[evidenceId],scope:'general',coverage:'component',hops:[],obligationRefs};}

test('one evaluator consumes Root-owned obligation mapping without another proof layer',()=>{
  const evaluated=new CompletionEvaluator().evaluate({task:task(),proposal:{finalResult:'只完成 A'},certifiedContext:{claims:[claim('C-A','E-A',['A'])]}});
  assert.equal(evaluated.goalState,GoalState.UNSATISFIED);
  assert.deepEqual(evaluated.satisfiedObligationIds,['A']);
  assert.deepEqual(evaluated.unsatisfiedObligationIds,['B']);
  assert.equal(evaluated.assessments.find(x=>x.obligationRefs[0]==='A').certification,'supported');
  assert.equal(evaluated.assessments.find(x=>x.obligationRefs[0]==='B').certification,'unresolved');
});

test('all mapped CONFIRMED Claims deterministically satisfy all obligations',()=>{
  const evaluated=new CompletionEvaluator().evaluate({task:task(),proposal:{finalResult:'A、B 已完成'},certifiedContext:{claims:[claim('C-A','E-A',['A']),claim('C-B','E-B',['B'])]}});
  assert.equal(evaluated.goalState,GoalState.SATISFIED);
  assert.deepEqual(evaluated.satisfiedObligationIds,['A','B']);
});

test('completion relation must be explicit and SUPPORTED inference cannot replace it',()=>{
  const current=task();
  const unmapped=new CompletionEvaluator().evaluate({task:current,proposal:{finalResult:'done'},certifiedContext:{claims:[claim('C-1','E-1')]}});
  assert.equal(unmapped.goalState,GoalState.UNSATISFIED);
  const inferred=new CompletionEvaluator().evaluate({task:current,proposal:{finalResult:'done'},certifiedContext:{claims:[claim('C-I','E-I',['A','B'],'supported')]}});
  assert.equal(inferred.goalState,GoalState.UNSATISFIED);
});
