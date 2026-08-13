import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionEvaluator, GoalState } from '../src/governance/completion-evaluator.js';

const evaluator = new CompletionEvaluator();
const obligation = (id, { mode='coverage', acceptedOutcomes=[] } = {}, certification='supported') => ({
  id,
  requirementRefs:[{sourceId:'REQ-T-1-0001',start:0,end:1}],
  criterion:{mode,acceptedOutcomes},
  certification,
  lineage:{type:'created',from:[]},
});
const assessment = ({id='A-1',obligationRefs=[],coverage='covered',outcome='achieved',evidenceRefs=['E-1'],certification='supported'}={}) => ({
  id,obligationRefs,coverage,outcome,evidenceRefs,certification,
});
const evaluate = ({obligations,assessments=[],...rest}) => evaluator.evaluate({
  taskContract:{id:'TC-T-1',revision:1,obligations},
  certifiedAssessments:assessments,
  ...rest,
});

test('A/B/C obligations stay unsatisfied when certified coverage proves only A',()=>{
  const result=evaluate({obligations:[obligation('O-A'),obligation('O-B'),obligation('O-C')],assessments:[assessment({obligationRefs:['O-A']})]});
  assert.equal(result.goalState,GoalState.UNSATISFIED);
  assert.deepEqual(result.unsatisfiedObligationIds,['O-B','O-C']);
});

test('duplicate WorkReceipts never manufacture obligation coverage',()=>{
  const receipts=[{id:'WU-1',signature:'same'},{id:'WU-1-copy',signature:'same'}];
  const result=evaluate({obligations:[obligation('O-A'),obligation('O-B')],assessments:[assessment({obligationRefs:['O-A'],evidenceRefs:['WU-1']})],workReceipts:receipts});
  assert.equal(result.goalState,GoalState.UNSATISFIED);
  assert.deepEqual(result.unsatisfiedObligationIds,['O-B']);
});

test('one certified semantic assessment may cover multiple obligation refs',()=>{
  const result=evaluate({obligations:[obligation('O-A'),obligation('O-B')],assessments:[assessment({obligationRefs:['O-A','O-B'],evidenceRefs:['E-shared']})]});
  assert.equal(result.goalState,GoalState.SATISFIED);
});

test('analysis coverage criterion accepts covered + gap when the obligation asked for coverage',()=>{
  const result=evaluate({obligations:[obligation('O-analysis',{mode:'coverage'})],assessments:[assessment({obligationRefs:['O-analysis'],coverage:'covered',outcome:'gap'})]});
  assert.equal(result.goalState,GoalState.SATISFIED);
});

test('execution outcome criterion rejects covered + blocked when achieved is required',()=>{
  const result=evaluate({obligations:[obligation('O-fix',{mode:'outcome',acceptedOutcomes:['achieved']})],assessments:[assessment({obligationRefs:['O-fix'],coverage:'covered',outcome:'blocked'})]});
  assert.equal(result.goalState,GoalState.UNSATISFIED);
});

test('Human or Reference evidence can satisfy an obligation without any WorkUnit receipt',()=>{
  const result=evaluate({obligations:[obligation('O-human'),obligation('O-reference')],assessments:[assessment({id:'A-human',obligationRefs:['O-human'],evidenceRefs:['human:HG-1']}),assessment({id:'A-reference',obligationRefs:['O-reference'],evidenceRefs:['reference:R-1']})],workReceipts:[]});
  assert.equal(result.goalState,GoalState.SATISFIED);
});

test('an unresolved governed obligation blocks Goal satisfaction without contaminating resolved siblings',()=>{
  const result=evaluate({obligations:[obligation('O-read'),obligation('O-write',{mode:'outcome',acceptedOutcomes:['achieved']},'unresolved')],assessments:[assessment({obligationRefs:['O-read']})]});
  assert.equal(result.goalState,GoalState.UNSATISFIED);
  assert.deepEqual(result.unsatisfiedObligationIds,['O-write']);
});

test('uncertified assessment is not completion proof',()=>{
  const result=evaluate({obligations:[obligation('O-A')],assessments:[assessment({obligationRefs:['O-A'],certification:'unresolved'})]});
  assert.equal(result.goalState,GoalState.UNSATISFIED);
});

test('legacy TaskStatus.COMPLETED cannot be used as Goal truth',()=>{
  const result=evaluate({obligations:[obligation('O-A')],assessments:[],taskStatus:'COMPLETED'});
  assert.equal(result.goalState,GoalState.UNSATISFIED);
});

test('outcome criterion becomes satisfied only from a certified accepted outcome',()=>{
  const result=evaluate({obligations:[obligation('O-fix',{mode:'outcome',acceptedOutcomes:['achieved']})],assessments:[assessment({obligationRefs:['O-fix'],outcome:'achieved'})]});
  assert.equal(result.goalState,GoalState.SATISFIED);
});
