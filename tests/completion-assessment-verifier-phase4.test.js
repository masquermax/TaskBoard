import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionAssessmentVerifier } from '../src/governance/completion-assessment-verifier.js';
import { CompletionEvaluator, GoalState } from '../src/governance/completion-evaluator.js';

function task(){const text='检查 A、B、C 并给出完整结论';return{id:'T-1',requirementSources:[{id:'REQ-T-1-0001',text}],taskContract:{obligations:[{id:'A',certification:'supported',requirementRefs:[{sourceId:'REQ-T-1-0001',start:0,end:text.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}},{id:'B',certification:'supported',requirementRefs:[{sourceId:'REQ-T-1-0001',start:0,end:text.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}}]}};}
function certifiedContext(){return{evidence:[{id:'E-A',strength:'direct',kind:'fact',sourceType:'runtime',coverage:'component',statement:'A 已完成',basis:'runtime',locator:'runtime:A',observation:'A 已完成'}],claims:[{id:'C-A',statement:'A 已完成',level:'confirmed',evidenceIds:['E-A'],scope:'general',coverage:'component',hops:[]}],gaps:[]};}

test('CompletionAssessmentVerifier certifies obligations from compact confirmed Task Claims and CompletionEvaluator remains the only aggregator',async()=>{
  let seenCandidates=[];
  const executor={async runValidator({candidates}){seenCandidates=candidates;return{reviews:candidates.map(candidate=>({id:candidate.id,verdict:candidate.targetId==='A'?'supported':'overreach',reason:candidate.targetId==='A'?'A proven':'B missing'}))};}};
  const verifier=new CompletionAssessmentVerifier({executor});
  const result=await verifier.review({task:task(),proposal:{finalResult:'只完成 A',summary:'A done'},certifiedContext:certifiedContext()});
  assert.equal(result.assessments.length,2);
  const a=result.assessments.find(x=>x.obligationRefs[0]==='A');
  assert.equal(a.certification,'supported');
  assert.equal(a.proofKind,'completion_obligation_support');
  assert.equal(a.criterionSatisfied,true);
  assert.deepEqual(a.proofFactRefs,['C-A']);
  assert.equal('outcome' in a,false);
  assert.deepEqual(seenCandidates[0].proofMaterial,[{id:'C-A',statement:'A 已完成',level:'confirmed',coverage:'component',scope:'general',evidenceIds:['E-A']}]);
  assert.equal(seenCandidates[0].proofMaterial.some(item=>item.id==='E-A'),false,'Completion does not resend the raw Evidence ledger after Claim certification');
  assert.equal(result.assessments.find(x=>x.obligationRefs[0]==='B').certification,'unresolved');
  const evaluated=new CompletionEvaluator().evaluate({taskContract:task().taskContract,certifiedAssessments:result.assessments});
  assert.equal(evaluated.goalState,GoalState.UNSATISFIED);
  assert.deepEqual(evaluated.unsatisfiedObligationIds,['B']);
});

test('CompletionAssessmentVerifier fails closed when Validator semantic certification is unavailable',async()=>{
  const verifier=new CompletionAssessmentVerifier({executor:{}});
  const result=await verifier.review({task:task(),proposal:{finalResult:'A B C'},certifiedContext:certifiedContext()});
  assert.equal(result.assessments.every(item=>item.certification==='unresolved'),true);
  assert.equal(new CompletionEvaluator().evaluate({taskContract:task().taskContract,certifiedAssessments:result.assessments}).goalState,GoalState.UNSATISFIED);
});

test('SUPPORTED inference is not promoted into completion proof',async()=>{
  let calls=0;
  const verifier=new CompletionAssessmentVerifier({executor:{async runValidator(){calls++;return{reviews:[]};}}});
  const context={evidence:[{id:'E-I',strength:'direct',kind:'fact',sourceType:'runtime',coverage:'component',statement:'局部事实',basis:'runtime',locator:'runtime:I',observation:'局部事实'}],claims:[{id:'C-I',statement:'推理结论',level:'supported',evidenceIds:['E-I'],scope:'general',coverage:'component',hops:[]}],gaps:[]};
  const result=await verifier.review({task:task(),proposal:{finalResult:'完成',summary:'done'},certifiedContext:context});
  assert.equal(calls,0,'no semantic completion model turn is useful when there is no CONFIRMED Task Claim');
  assert.equal(result.assessments.every(item=>item.certification==='unresolved'),true);
});
