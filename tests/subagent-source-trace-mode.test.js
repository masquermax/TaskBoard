import test from 'node:test';
import assert from 'node:assert/strict';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';

test('Subagent Evidence source-trace semantics presented to Root are independent of inferred taskMode', async()=>{
  let traceCalls=0;
  const sourceTraceVerifier={
    enforce({evidence}){
      traceCalls+=1;
      return {
        evidence:(evidence||[]).map(item=>({...item,strength:'indirect'})),
        actions:[],
        verifications:[],
      };
    },
  };
  const executor={
    async runSubagent(){
      return {
        delegationId:'WU-TRACE',
        result:'done',
        evidence:[{
          id:'E-TRACE',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',
          statement:'事实',basis:'src/a.js#L1',locator:'src/a.js#L1',observation:'事实',
        }],
        findings:[{id:'F-1',statement:'事实',evidenceIds:['E-TRACE']}],
        discoveries:[],blocker:null,uncertainty:null,
      };
    },
  };
  const modelRouter={async prepare(){},route(){return{};}};
  const runtime=new SubagentRuntime({executor,modelRouter,sourceTraceVerifier});
  const task={id:'T-TRACE',title:'trace',instruction:'trace',projectScopes:[],attachments:[],references:[]};
  const delegation={
    id:'WU-TRACE',title:'trace',goal:'trace',expectedOutput:'evidence',stopCondition:'done',
    projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[],
  };

  const analysis=await runtime.run(task,delegation,{policyContext:{taskMode:'analysis'}});
  const execution=await runtime.run(task,delegation,{policyContext:{taskMode:'execution'}});

  assert.equal(traceCalls,2,'SourceTrace is an Evidence boundary, not taskMode-controlled Runtime semantics');
  assert.equal(analysis.evidence[0].strength,'indirect');
  assert.equal(execution.evidence[0].strength,'indirect');
  assert.deepEqual(execution.evidence,analysis.evidence);
});
