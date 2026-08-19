import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';

function task(){
  const text='完成目标';
  return{id:'T-CLOSURE',title:'Closure',instruction:text,projectScopes:[],attachments:[],references:[],workReceipts:[{id:'OLD-WORK',signature:'old',workUnit:{id:'OLD-WORK',title:'old'},result:{delegationId:'OLD-WORK',result:'old',evidence:[]},consumed_at:'2026-01-01T00:00:00Z'}],requirementSources:[{id:'REQ-T-CLOSURE-0001',text}],taskContract:{obligations:[{id:'O-1',certification:'supported',requirementRefs:[{sourceId:'REQ-T-CLOSURE-0001',start:0,end:text.length}]},{id:'O-2',certification:'supported',requirementRefs:[{sourceId:'REQ-T-CLOSURE-0001',start:0,end:text.length}]}]},analysisState:{version:3,current:{resultMode:'analysis',evidence:[{id:'E-OLD',strength:'direct',kind:'fact',sourceType:'human',coverage:'source',statement:'old',basis:'old',locator:'old',observation:'old'}],claims:[{id:'C-OLD',statement:'old fact',level:'confirmed',evidenceIds:['E-OLD'],scope:'general',coverage:'source',hops:[],obligationRefs:['O-1']}],gaps:[{id:'G-1',question:'remaining?',reason:'unknown',kind:'missing_fact',blocking:false,evidenceIds:[]}],recommendations:[],steps:[]},turns:[]}};
}

test('Root receives fresh delta plus compact semantic grid instead of replaying old raw process/evidence',async()=>{
  let request=null;
  const executor={async runRoot(value){request=value;value.onExecutionStarted?.();return{kind:'delegate',summary:'next',stageResult:null,finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[{id:'WU-NEXT',title:'next',goal:'resolve G-1',expectedOutput:'one discriminator',stopCondition:'discriminator found',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]}]};}};
  const runtime=new RootRuntime({executor,modelRouter:new ModelRouter(),subagentRuntime:{}}),current=task(),session=runtime.createSession(current);
  const fresh=[{delegationId:'WU-FRESH',result:'new fact',evidence:[{id:'E-NEW'}]}];
  await runtime.runRootTurn(current,session,{}, {rootInputs:fresh,activityKind:'synthesis'});
  assert.deepEqual(request.subagentResults,fresh);
  assert.deepEqual(request.task.workReceipts,[],'old execution receipts are not replayed into Root');
  assert.equal(request.task.analysisState,null,'durable analysis history is not duplicated inside Task payload');
  assert.equal('evidence' in request.certifiedContext,false,'old raw Evidence payload is not replayed into Root semantic grid');
  assert.deepEqual(request.certifiedContext.claims.map(item=>item.id),['C-OLD']);
  assert.deepEqual(request.certifiedContext.gaps.map(item=>item.id),['G-1']);
  assert.deepEqual(request.certifiedContext.unresolvedObligations.map(item=>item.id),['O-2'],'already satisfied obligation is removed from residual work');
});
