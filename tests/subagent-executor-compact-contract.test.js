import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexExecutor, subagentSchema } from '../src/extensions/executors/codex/codex-executor.js';

test('Codex Subagent contract is execution-only and contains no Task-level judgment surface',()=>{
  const executor=new CodexExecutor({runtimeRoot:process.cwd(),client:{},environmentProbe:()=>({checkedAt:'now',rg:true,python:null,pythonModules:{pdf2image:false,lxml:false},libreOffice:false,wordDesktopBinary:false})});
  const task={id:'T-1',title:'定位目标',instruction:'定位目标',projectScopes:[],attachments:[],references:[]},delegation={id:'WU-1',title:'定位文件',goal:'定位目标逻辑所在文件',expectedOutput:'文件定位和直接证据',stopCondition:'找到并核对目标逻辑后立即停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};
  assert.deepEqual(Object.keys(subagentSchema.properties).sort(),['blocker','delegationId','evidence','result']);assert.deepEqual([...subagentSchema.required].sort(),['blocker','delegationId','evidence','result']);for(const field of ['findings','discoveries','uncertainty','claims','gaps','recommendations','effectActuationClosure'])assert.equal(field in subagentSchema.properties,false);
  const prompt=executor.subagentPrompt({task,delegation});
  assert.match(prompt,/Execute exactly delegation\.goal/i);assert.match(prompt,/expectedOutput \+ delegation\.stopCondition are the complete semantic boundary/i);assert.match(prompt,/Stop immediately when that bounded output is established/i);assert.match(prompt,/Do not expand the Task or select a new goal/i);assert.match(prompt,/Return only result \+ traceable source-near Evidence \+ optional execution blocker/i);assert.match(prompt,/effect closure/i);assert.match(prompt,/Root decides what happens next/i);assert.doesNotMatch(prompt,/findings\[\]|discoveries\[\]|suggestedNextQuestion/);
});
