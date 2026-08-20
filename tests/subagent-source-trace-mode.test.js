import test from 'node:test';
import assert from 'node:assert/strict';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';

function task(){return{id:'T-TRACE',title:'trace',instruction:'trace',projectScopes:[],attachments:[],references:[]};}
function delegation(){return{id:'WU-TRACE',title:'trace',goal:'trace',expectedOutput:'evidence',stopCondition:'done',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};}

test('Subagent execution hands raw source candidates to Root without running Validator provenance work',async()=>{
  const executor={async runSubagent(){return{delegationId:'WU-TRACE',result:'done',evidence:[{id:'E-TRACE',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'事实',basis:'src/a.js#L1',locator:'src/a.js#L1',observation:'事实'}],blocker:null};}};
  const runtime=new SubagentRuntime({executor,modelRouter:{async prepare(){},route(){return{};}}});
  const result=await runtime.run(task(),delegation());
  assert.equal(result.evidence[0].strength,'direct','SubagentRuntime must not pre-certify or downgrade the source candidate');
});

test('Subagent cannot smuggle a semantic effect-closure decision through its raw result',async()=>{
  const executor={async runSubagent(){return{delegationId:'WU-TRACE',result:'observed',evidence:[{id:'E-CLOSE',strength:'direct',kind:'fact',sourceType:'runtime',coverage:'component',statement:'process absent',basis:'runtime record',locator:'runtime://record',observation:'process absent'}],blocker:null,effectActuationClosure:{effectAttemptId:'effect:old',terminal:true,canMutate:false,evidenceIds:['E-CLOSE']}};}};
  const runtime=new SubagentRuntime({executor,modelRouter:{async prepare(){},route(){return{};}}});
  const result=await runtime.run(task(),delegation());
  assert.deepEqual(Object.keys(result).sort(),['blocker','delegationId','evidence','result']);
  assert.equal('effectActuationClosure' in result,false,'effect/liveness judgment belongs to Root, not Subagent');
});
