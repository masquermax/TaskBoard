import test from 'node:test';
import assert from 'node:assert/strict';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';

function evidence(){return{id:'E-1',strength:'direct',kind:'fact',sourceType:'human',coverage:'source',statement:'JDK = 1.7',basis:'human',locator:'human',observation:'JDK = 1.7'};}
function claim(overrides={}){return{id:'C-1',statement:'JDK is 1.7',level:'confirmed',evidenceIds:['E-1'],scope:'single_system',coverage:'component',hops:[],factProperty:'',factValue:'',subjectRefs:[],obligationRefs:[],...overrides};}
function decision(claims){return{kind:'complete',summary:'done',finalResult:null,resultMode:'analysis',evidence:[evidence()],claims,gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};}
function runtime(){return new ValidatorRuntime({sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:[]})}});}

test('factual Reality coordinate is all-or-none: property without value is rejected',()=>{
  const out=runtime().reviewRoot({task:{id:'T'},decision:decision([claim({factProperty:'JDK'})])});
  assert.equal(out.outcome,'reject');
  assert.ok(out.feedback.some(item=>item.action==='REJECT_INCOMPLETE_FACT_COORDINATE'));
});

test('factual Reality coordinate is all-or-none: value without property is rejected',()=>{
  const out=runtime().reviewRoot({task:{id:'T'},decision:decision([claim({factValue:'1.7'})])});
  assert.equal(out.outcome,'reject');
  assert.ok(out.feedback.some(item=>item.action==='REJECT_INCOMPLETE_FACT_COORDINATE'));
});

test('ordinary Claim with both factual coordinate fields empty remains valid',()=>{
  const out=runtime().reviewRoot({task:{id:'T'},decision:decision([claim({statement:'A relation or conclusion that is not one parameter slot'})])});
  assert.equal(out.outcome,'pass');
});
