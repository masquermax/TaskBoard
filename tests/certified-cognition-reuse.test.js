import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CERTIFIED_COGNITION_REUSE_CAPABILITY,
  certifiedCognitionReuseInstructions,
  projectCertifiedKnownClaims,
  rootRealityContinuityInstructions,
} from '../src/core/certified-cognition-reuse.js';
import { compileSubagentExecutorRequest } from '../src/core/executor-contract.js';
import { scopeTaskInputs } from '../src/core/task-input-scope.js';
import { compileAuthorizedGrant } from '../src/governance/governance-compiler.js';

function task(){
  return {
    id:'T-REUSE',title:'reuse',instruction:'continue from known reality',
    projectScopes:[{path:'/project',label:'project'}],attachments:[],references:[],
    taskContract:{id:'TC-REUSE',revision:1,authority:{},obligations:[{id:'OBL-1'}],constraints:[]},
    analysisState:{current:{claims:[
      {id:'C-JDK',statement:'JDK is 1.7',level:'confirmed',evidenceIds:['E-JDK'],scope:'single_system',coverage:'component',obligationRefs:['OBL-1']},
      {id:'C-GUESS',statement:'Font issue may be caused by JDK',level:'supported',evidenceIds:['E-JDK'],scope:'single_system',coverage:'component',obligationRefs:[]},
    ]}},
  };
}

function work(overrides={}){
  return {id:'WU-1',title:'inspect fonts',goal:'inspect the font dependency only',expectedOutput:'font dependency evidence',stopCondition:'font dependency established or blocked',obligationRefs:['OBL-1'],projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0'],...overrides};
}

test('capability has a stable runtime identity',()=>{
  assert.equal(CERTIFIED_COGNITION_REUSE_CAPABILITY,'certified-cognition-reuse');
});

test('A1/A2: only CONFIRMED cognition is projected as reusable knownClaims',()=>{
  const known=projectCertifiedKnownClaims(task());
  assert.deepEqual(known,[{
    id:'C-JDK',statement:'JDK is 1.7',evidenceIds:['E-JDK'],scope:'single_system',coverage:'component',obligationRefs:['OBL-1'],
  }]);
  assert.equal(known.some(item=>item.id==='C-GUESS'),false,'SUPPORTED inference must not become execution memory');
});

test('projection is detached from durable state',()=>{
  const source=task();
  const known=projectCertifiedKnownClaims(source);
  known[0].statement='mutated';
  known[0].evidenceIds.push('E-X');
  assert.equal(source.analysisState.current.claims[0].statement,'JDK is 1.7');
  assert.deepEqual(source.analysisState.current.claims[0].evidenceIds,['E-JDK']);
});

test('real child input scoping keeps Certified State available for compact projection',()=>{
  const scoped=scopeTaskInputs(task(),['project:0']);
  const request=compileSubagentExecutorRequest({task:scoped,delegation:work()});
  assert.deepEqual(request.context.knownClaims.map(item=>item.id),['C-JDK']);
  assert.equal(request.context.knownClaims.some(item=>item.id==='C-GUESS'),false);
});

test('A3: protocol requires conflicting fresh Reality to return upward instead of silently overwriting cognition',()=>{
  const instructions=certifiedCognitionReuseInstructions();
  assert.match(instructions,/fresh direct Reality conflicts/i);
  assert.match(instructions,/source-near Evidence/i);
  assert.match(instructions,/do not silently overwrite parent cognition/i);
  assert.match(instructions,/explicitly requires revalidation|explicitly require revalidation|explicitly requires revalidation/i);
});

test('A3 Root reopen revises the existing Claim instead of accumulating contradictory active cognition',()=>{
  const instructions=rootRealityContinuityInstructions();
  assert.match(instructions,/fresh DIRECT Evidence invalidates a current Claim/i);
  assert.match(instructions,/revise that existing Claim id/i);
  assert.match(instructions,/one active value/i);
  assert.match(instructions,/Do not add a second contradictory active Claim/i);
  assert.match(instructions,/turn history already preserves the prior value/i);
});

test('A4: known cognition cannot widen executable authority',()=>{
  const source=task();
  const grant=compileAuthorizedGrant({role:'subagent',task:source,workUnit:work({projectAccess:'write',networkAccess:true})});
  assert.equal(grant.projectAccess,'read');
  assert.equal(grant.networkAccess,false);
});

test('executor contract tells child to reuse certified cognition without replaying history',()=>{
  const request=compileSubagentExecutorRequest({task:task(),delegation:work()});
  assert.deepEqual(request.context.knownClaims.map(item=>item.statement),['JDK is 1.7']);
  assert.match(request.instructions,/do not spend this Work merely rediscovering the same fact/i);
  assert.match(request.instructions,/Re-observation is valid only when/i);
  assert.equal('workReceipts' in request.context,false);
});