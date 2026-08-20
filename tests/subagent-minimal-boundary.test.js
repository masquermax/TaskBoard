import test from 'node:test';
import assert from 'node:assert/strict';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';

test('Subagent result boundary keeps only execution output, source evidence, and execution blocker', async()=>{
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
        uncertainty:'模型自己的局部判断不应越过执行边界',
        effectActuationClosure:{effectAttemptId:'effect:old',terminal:true,canMutate:false,evidenceIds:['E-1']},
      };
    },
  };
  const modelRouter={async prepare(){},route(){return{};}};
  const runtime=new SubagentRuntime({executor,modelRouter});
  const task={id:'T-1',title:'定位目标文件',instruction:'定位目标文件',projectScopes:[],attachments:[],references:[]};
  const delegation={id:'WU-1',title:'定位文件',goal:'定位目标逻辑所在文件',expectedOutput:'文件定位和直接证据',stopCondition:'找到并核对目标逻辑后立即停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};

  const result=await runtime.run(task,delegation);

  assert.deepEqual(result,{
    delegationId:'WU-1',
    result:'目标文件已定位。',
    evidence:[{
      id:'E-1',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',
      statement:'目标逻辑存在',basis:'src/target.js#L10-L16',locator:'src/target.js#L10-L16',observation:'目标逻辑存在',
    }],
    blocker:null,
  });
  assert.equal('findings' in result,false,'Subagent does not own interpretation of its execution output');
  assert.equal('discoveries' in result,false,'Subagent cannot propose Task-level next work');
  assert.equal('uncertainty' in result,false,'uncertainty classification belongs to Root');
  assert.equal('effectActuationClosure' in result,false,'effect/liveness judgment belongs to Root');
});
