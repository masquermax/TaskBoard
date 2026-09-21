import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCertifiedKnownClaims } from '../src/core/certified-cognition-reuse.js';
import { applyCertifiedDelta, emptyCertifiedState } from '../src/governance/certified-state.js';

function claim({id,statement,property='',value='',subject='server:A',evidenceId='E-1'}){
  return {
    id,
    statement,
    level:'confirmed',
    evidenceIds:[evidenceId],
    scope:'single_system',
    coverage:'component',
    hops:[],
    factProperty:property,
    factValue:value,
    subjectRefs:subject?[subject]:[],
    obligationRefs:[],
  };
}

function evidence(id){return{id,strength:'direct'};}

test('explicit factual coordinate collapses paraphrases without making Claim id the meaning',()=>{
  const task={analysisState:{current:{claims:[
    claim({id:'C-1',statement:'JDK is 1.7',property:'JDK',value:'1.7',evidenceId:'E-1'}),
    claim({id:'C-2',statement:'Java runtime version = 1.7',property:'JDK',value:'1.7',evidenceId:'E-2'}),
  ]}}};
  const known=projectCertifiedKnownClaims(task,{subjectRefs:['server:A']});
  assert.equal(known.length,1);
  assert.equal(known[0].factProperty,'JDK');
  assert.equal(known[0].factValue,'1.7');
  assert.deepEqual(known[0].evidenceIds,['E-1','E-2']);
});

test('Runtime does not guess paraphrase equivalence when no factual coordinate is declared',()=>{
  const task={analysisState:{current:{claims:[
    claim({id:'C-1',statement:'JDK is 1.7'}),
    claim({id:'C-2',statement:'Java runtime version = 1.7',evidenceId:'E-2'}),
  ]}}};
  const known=projectCertifiedKnownClaims(task,{subjectRefs:['server:A']});
  assert.equal(known.length,2);
});

test('same factual property on different subjects remains separate Reality',()=>{
  const task={analysisState:{current:{claims:[
    claim({id:'C-A',statement:'A JDK is 1.7',property:'JDK',value:'1.7',subject:'server:A'}),
    claim({id:'C-B',statement:'B JDK is 1.7',property:'JDK',value:'1.7',subject:'server:B',evidenceId:'E-2'}),
  ]}}};
  const known=projectCertifiedKnownClaims(task,{subjectRefs:['server:A','server:B']});
  assert.equal(known.length,2);
  assert.deepEqual(known.map(item=>item.subjectRefs[0]).sort(),['server:A','server:B']);
});

test('fresh value for the same factual slot revises the existing active Claim id',()=>{
  const first=applyCertifiedDelta(emptyCertifiedState(),{
    evidence:[evidence('E-1')],
    claims:[claim({id:'C-JDK',statement:'JDK is 1.7',property:'JDK',value:'1.7',evidenceId:'E-1'})],
  });
  const second=applyCertifiedDelta(first.state,{
    evidence:[evidence('E-2')],
    claims:[claim({id:'C-NEW',statement:'Java runtime version is now 8',property:'JDK',value:'8',evidenceId:'E-2'})],
  });
  assert.deepEqual(second.issues,[]);
  assert.equal(second.state.current.claims.length,1);
  assert.equal(second.state.current.claims[0].id,'C-JDK');
  assert.equal(second.state.current.claims[0].factValue,'8');
  assert.deepEqual(second.state.current.claims[0].evidenceIds,['E-2']);
  assert.equal(second.state.turns.length,2,'prior value stays in turn provenance rather than active current cognition');
  assert.equal(second.state.turns[0].delta.claims[0].factValue,'1.7');
});

test('same-slot value change without new Evidence is rejected rather than silently overwritten',()=>{
  const first=applyCertifiedDelta(emptyCertifiedState(),{
    evidence:[evidence('E-1')],
    claims:[claim({id:'C-JDK',statement:'JDK is 1.7',property:'JDK',value:'1.7',evidenceId:'E-1'})],
  });
  const second=applyCertifiedDelta(first.state,{
    evidence:[],
    claims:[claim({id:'C-NEW',statement:'JDK is 8',property:'JDK',value:'8',evidenceId:'E-1'})],
  });
  assert.equal(second.state.current.claims[0].factValue,'1.7');
  assert.equal(second.issues[0].code,'CLAIM_FACT_SLOT_REVISION_REQUIRES_NEW_EVIDENCE');
});
