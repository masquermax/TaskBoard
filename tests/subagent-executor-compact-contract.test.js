import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexExecutor, subagentSchema } from '../src/extensions/executors/codex/codex-executor.js';

test('Codex Subagent contract is execution-only and contains no Task-level judgment surface',()=>{
  const executor=new CodexExecutor({
    runtimeRoot:process.cwd(),
    client:{},
    environmentProbe:()=>({checkedAt:'now',rg:true,python:null,pythonModules:{pdf2image:false,lxml:false},libreOffice:false,wordDesktopBinary:false}),
  });
  const task={id:'T-1',title:'定位目标',instruction:'定位目标',projectScopes:[],attachments:[],references:[]};
  const delegation={id:'WU-1',title:'定位文件',goal:'定位目标逻辑所在文件',expectedOutput:'文件定位和直接证据',stopCondition:'找到并核对目标逻辑后立即停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};

  assert.deepEqual(Object.keys(subagentSchema.properties).sort(),['blocker','delegationId','evidence','result']);
  assert.deepEqual([...subagentSchema.required].sort(),['blocker','delegationId','evidence','result']);
  for(const field of ['findings','discoveries','uncertainty','claims','gaps','recommendations'])assert.equal(field in subagentSchema.properties,false);

  const prompt=executor.subagentPrompt({task,delegation});
  assert.match(prompt,/Stop as soon as expectedOutput is established/i);
  assert.match(prompt,/Do not investigate, plan, or suggest work outside this Work Unit/i);
  assert.match(prompt,/Do not classify correctness, confidence, Task truth, Gap, recommendation, completion, next work/i);
  assert.match(prompt,/Keep result compact/i);
  assert.doesNotMatch(prompt,/findings\[\]/);
  assert.doesNotMatch(prompt,/suggestedNextQuestion/);
  assert.doesNotMatch(prompt,/discoveries\[\]/);
});
