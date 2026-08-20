import test from 'node:test';
import assert from 'node:assert/strict';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';

test('ordinary Subagent execution hands raw source candidates to Root without running Validator provenance work',async()=>{
  let traceCalls=0;
  const sourceTraceVerifier={enforce(){traceCalls+=1;throw new Error('ordinary Work must not verify provenance before Root cites it');}};
  const executor={
    async runSubagent(){return{
      delegationId:'WU-TRACE',result:'done',
      evidence:[{id:'E-TRACE',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'事实',basis:'src/a.js#L1',locator:'src/a.js#L1',observation:'事实'}],
      blocker:null,
    };},
  };
  const modelRouter={async prepare(){},route(){return{};}};
  const runtime=new SubagentRuntime({executor,modelRouter,sourceTraceVerifier});
  const task={id:'T-TRACE',title:'trace',instruction:'trace',projectScopes:[],attachments:[],references:[]};
  const delegation={id:'WU-TRACE',title:'trace',goal:'trace',expectedOutput:'evidence',stopCondition:'done',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};

  const result=await runtime.run(task,delegation);
  assert.equal(traceCalls,0,'Validator is the sole ordinary source/provenance checker');
  assert.equal(result.evidence[0].strength,'direct','SubagentRuntime must not pre-certify or downgrade the source candidate');
});

test('effect recovery closure is the narrow exception that verifies DIRECT provenance before reopening mutation',async()=>{
  let traceCalls=0;
  const evidence={id:'E-CLOSE',strength:'direct',kind:'fact',sourceType:'runtime',coverage:'component',statement:'old mutator stopped',basis:'runtime record',locator:'runtime://record',observation:'old mutator stopped'};
  const sourceTraceVerifier={enforce({evidence:items}){traceCalls+=1;return{evidence:items,actions:[],verifications:[{id:'E-CLOSE',verified:true}]};}};
  const executor={async runSubagent(){return{delegationId:'WU-OBSERVE',result:'closed',evidence:[evidence],blocker:null,effectActuationClosure:{effectAttemptId:'effect:old',terminal:true,canMutate:false,evidenceIds:['E-CLOSE']}};}};
  const runtime=new SubagentRuntime({executor,modelRouter:{async prepare(){},route(){return{};}},sourceTraceVerifier});
  const task={id:'T',projectScopes:[],attachments:[],references:[],executionState:{retry:{scope:'effect-recovery-observe'},recovery:{effectAttempts:[{id:'effect:old',resolved:false}]}}};
  const delegation={id:'WU-OBSERVE',title:'observe',goal:'observe old effect',expectedOutput:'closure evidence',stopCondition:'closure observed',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};
  const result=await runtime.run(task,delegation);
  assert.equal(traceCalls,1);
  assert.deepEqual(result.effectActuationClosure,{effectAttemptId:'effect:old',terminal:true,canMutate:false,evidenceIds:['E-CLOSE']});
});
