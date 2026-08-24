import test from 'node:test';
import assert from 'node:assert/strict';
import { SUBAGENT_RESPONSE_CONTRACT, compileSubagentExecutorRequest } from '../src/core/executor-contract.js';

test('Core Subagent executor contract is execution-only and contains no Task-level judgment surface',()=>{
  const task={id:'T-1',title:'定位目标',instruction:'定位目标',projectScopes:[],attachments:[],references:[]},delegation={id:'WU-1',title:'定位文件',goal:'定位目标逻辑所在文件',expectedOutput:'文件定位和直接证据',stopCondition:'找到并核对目标逻辑后立即停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};
  assert.deepEqual(Object.keys(SUBAGENT_RESPONSE_CONTRACT.properties).sort(),['blocker','delegationId','evidence','result']);assert.deepEqual([...SUBAGENT_RESPONSE_CONTRACT.required].sort(),['blocker','delegationId','evidence','result']);for(const field of ['findings','discoveries','uncertainty','claims','gaps','recommendations','effectActuationClosure'])assert.equal(field in SUBAGENT_RESPONSE_CONTRACT.properties,false);
  const request=compileSubagentExecutorRequest({task,delegation,policyContext:{prompt:'ROLE SUBAGENT',authorizedGrant:{role:'subagent',projectAccess:'none',networkAccess:false,inputRefs:[]}},executorContext:{rg:true}}),prompt=request.instructions;
  assert.match(prompt,/Execute exactly workUnit\.goal/i);assert.match(prompt,/workUnit\.expectedOutput \+ workUnit\.stopCondition are the complete semantic boundary/i);assert.match(prompt,/Stop immediately when that bounded output is established/i);assert.match(prompt,/Do not expand the Task or select a new goal/i);assert.match(prompt,/Return only result \+ traceable source-near Evidence \+ optional execution blocker/i);assert.match(prompt,/effect closure/i);assert.match(prompt,/Root decides what happens next/i);assert.doesNotMatch(prompt,/findings\[\]|discoveries\[\]|suggestedNextQuestion/);assert.equal(request.context.executorRuntime.rg,true);
});
