import test from 'node:test';
import assert from 'node:assert/strict';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';

test('Subagent result boundary drops out-of-scope next-work suggestions and keeps only current Work Unit evidence', async()=>{
  const sourceTraceVerifier={
    enforce({evidence}){return{evidence:Array.isArray(evidence)?evidence:[],actions:[],verifications:[]};},
  };
  const executor={
    async runSubagent(){
      return{
        delegationId:'WU-1',
        result:'目标文件已定位。',
        evidence:[{
          id:'E-1',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',
          statement:'目标逻辑存在',basis:'src/target.js#L10-L16',locator:'src/target.js#L10-L16',observation:'目标逻辑存在',
        }],
        findings:[{id:'F-1',statement:'目标文件与当前 Work Unit 目标一致。',evidenceIds:['E-1']}],
        discoveries:[{summary:'顺便发现另一个问题',whyRelevant:'可能值得继续研究',suggestedNextQuestion:'是否再创建一个 Work Unit？'}],
        blocker:null,
        uncertainty:null,
      };
    },
  };
  const modelRouter={async prepare(){},route(){return{};}};
  const runtime=new SubagentRuntime({executor,modelRouter,sourceTraceVerifier});
  const task={id:'T-1',title:'定位目标文件',instruction:'定位目标文件',projectScopes:[],attachments:[],references:[]};
  const delegation={id:'WU-1',title:'定位文件',goal:'定位目标逻辑所在文件',expectedOutput:'文件定位和直接证据',stopCondition:'找到并核对目标逻辑后立即停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};

  const result=await runtime.run(task,delegation);

  assert.equal(result.result,'目标文件已定位。');
  assert.deepEqual(result.evidence.map(item=>item.id),['E-1']);
  assert.deepEqual(result.findings.map(item=>item.id),['F-1']);
  assert.deepEqual(result.discoveries,[],'Subagent cannot use a local Work Unit result to propose or schedule Task-level next work');
  assert.equal(result.blocker,null);
});
