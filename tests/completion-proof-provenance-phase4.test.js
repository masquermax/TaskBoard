import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionAssessmentVerifier } from '../src/governance/completion-assessment-verifier.js';
import { CompletionEvaluator, GoalState } from '../src/governance/completion-evaluator.js';

function wholeGoalTask(instruction='完成 A + B + C') {
  return {
    id:'T-proof',
    requirementSources:[{id:'REQ-T-proof-0001',text:instruction}],
    taskContract:{
      obligations:[{
        id:'OBL-T-proof-GOAL',
        certification:'supported',
        requirementRefs:[{sourceId:'REQ-T-proof-0001',start:0,end:instruction.length}],
        criterion:{mode:'outcome',acceptedOutcomes:['succeeded']},
      }],
    },
  };
}

const certifiedContext = {
  evidence:[{id:'E-A',strength:'direct',kind:'fact',sourceType:'runtime',coverage:'component',statement:'A 已完成',basis:'runtime',locator:'runtime:A',observation:'A 已完成'}],
  claims:[{id:'C-A',statement:'A 已完成',level:'confirmed',evidenceIds:['E-A'],scope:'general',coverage:'component',hops:[]}],
  gaps:[],
};

test('Completion proposal and Requirement provenance are structurally outside certified proof material', async()=>{
  let captured=null;
  const verifier=new CompletionAssessmentVerifier({executor:{async runValidator({candidates}){captured=candidates[0];return{reviews:[{id:captured.id,verdict:'supported',reason:'certified facts satisfy criterion'}]};}}});
  const result=await verifier.review({task:wholeGoalTask('完成 A'),proposal:{finalResult:'Root says everything is done',summary:'done'},certifiedContext});
  assert.equal(captured.proofKind,'completion_obligation_support');
  assert.deepEqual(captured.proposal,{finalResult:'Root says everything is done',summary:'done',stageResult:null});
  assert.equal(Array.isArray(captured.requirementContext),true);
  assert.equal(captured.requirementContext[0].text,'完成 A');
  assert.equal(Array.isArray(captured.proofMaterial),true);
  assert.deepEqual(captured.proofMaterial.map(item=>item.id).sort(),['C-A','E-A']);
  assert.equal('evidence' in captured,false);
  assert.equal(JSON.stringify(captured.proofMaterial).includes('Root says everything is done'),false);
  assert.equal(JSON.stringify(captured.proofMaterial).includes('完成 A + B + C'),false);
  const assessment=result.assessments[0];
  assert.equal(assessment.proofKind,'completion_obligation_support');
  assert.equal(assessment.criterionSatisfied,true);
  assert.notEqual(assessment.outcome,'succeeded');
  assert.deepEqual(assessment.proofFactRefs.sort(),['C-A','E-A']);
});

test('Root says done with zero certified facts cannot manufacture Completion proof', async()=>{
  let calls=0;
  const verifier=new CompletionAssessmentVerifier({executor:{async runValidator(){calls+=1;return{reviews:[]};}}});
  const task=wholeGoalTask('修复登录失败');
  const verified=await verifier.review({task,proposal:{finalResult:'已经修复完成'},certifiedContext:{evidence:[],claims:[],gaps:[]}});
  assert.equal(calls,0);
  assert.equal(verified.assessments[0].certification,'unresolved');
  assert.equal(new CompletionEvaluator().evaluate({taskContract:task.taskContract,certifiedAssessments:verified.assessments}).goalState,GoalState.UNSATISFIED);
});

test('whole Requirement A+B+C stays unsatisfied when certified facts prove only A', async()=>{
  let captured=null;
  const executor={async runValidator({candidates}){captured=candidates[0];const requirement=captured.requirementContext.map(item=>item.text).join('\n');const facts=captured.proofMaterial.map(item=>item.statement||item.observation||'').join('\n');const full=requirement.includes('A')&&requirement.includes('B')&&requirement.includes('C');const complete=facts.includes('A')&&facts.includes('B')&&facts.includes('C');return{reviews:[{id:captured.id,verdict:full&&complete?'supported':'overreach',reason:'partial proof'}]};}};
  const task=wholeGoalTask();
  const verified=await new CompletionAssessmentVerifier({executor}).review({task,proposal:{finalResult:'全部完成'},certifiedContext});
  assert.equal(captured.proofMaterial.some(item=>(item.statement||item.observation||'').includes('B')),false);
  assert.equal(verified.assessments[0].certification,'unresolved');
  assert.equal(new CompletionEvaluator().evaluate({taskContract:task.taskContract,certifiedAssessments:verified.assessments}).goalState,GoalState.UNSATISFIED);
});