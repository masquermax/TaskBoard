import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { taskInputCatalog, scopeTaskInputs } from '../src/core/task-input-scope.js';
import { ROOT_RESPONSE_CONTRACT, compileSubagentExecutorRequest } from '../src/core/executor-contract.js';
import { validateDelegationPlan } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';

function taskFixture(root){
  return {
    id:'T-scope',title:'范围核对',instruction:'只分析当前选中输入',
    projectScopes:[
      {source:'registry',projectId:'P1',label:'A',path:join(root,'project-a')},
      {source:'registry',projectId:'P2',label:'B',path:join(root,'project-b')},
    ],
    attachments:[
      {id:'A-1',name:'one.png',mimeType:'image/png',size:1,path:join(root,'one.png')},
      {id:'A-2',name:'two.png',mimeType:'image/png',size:1,path:join(root,'two.png')},
    ],
    references:[
      {source_task_id:'T-old-1',title:'旧结果1',final_result:'R1'},
      {source_task_id:'T-old-2',title:'旧结果2',final_result:'R2'},
    ],
  };
}

test('Task input catalog exposes stable refs and a Work Unit receives only selected Task inputs',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-input-scope-'));
  try{
    const task=taskFixture(dir);
    const refs=taskInputCatalog(task).map(x=>x.ref);
    assert.deepEqual(refs,['task:instruction','project:0','project:1','attachment:A-1','attachment:A-2','reference:T-old-1','reference:T-old-2']);
    assert.equal(taskInputCatalog(task).some(item=>'path' in item),false,'Root catalog must not expose local project paths');
    const scoped=scopeTaskInputs(task,['project:1','attachment:A-2','reference:T-old-2']);
    assert.equal(scoped.instruction,'');
    assert.deepEqual(scoped.projectScopes.map(x=>x.label),['B']);
    assert.equal(scoped.projectScopes[0].inputRef,'project:1','scoping must preserve the original logical Project ref');
    assert.deepEqual(scoped.attachments.map(x=>x.id),['A-2']);
    assert.deepEqual(scoped.references.map(x=>x.source_task_id),['T-old-2']);
    task.certifiedState={claims:[{id:'secret'}]};task.pendingGateway={id:'HG'};task.final_result='secret';
    const safe=scopeTaskInputs(task,['project:1']);
    assert.equal('certifiedState' in safe,false);assert.equal('pendingGateway' in safe,false);assert.equal('final_result' in safe,false);
    const empty=scopeTaskInputs(task);assert.deepEqual(empty.projectScopes,[]);assert.deepEqual(empty.attachments,[]);assert.equal(empty.instruction,'');
    const instruction=scopeTaskInputs(task,['task:instruction']);assert.equal(instruction.instruction,task.instruction);assert.equal(instruction.projectScopes.length,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('new Work Units validate inputRefs and Project capability must select a Project Scope',()=>{
  const base={id:'w',title:'改文件',goal:'修改目标',expectedOutput:'返回结果',stopCondition:'完成即停',projectAccess:'write',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']};
  const allowed=['task:instruction','project:0','attachment:A-1'];
  assert.equal(validateDelegationPlan([base],{availableInputRefs:allowed}).valid,true);
  const missingProject=validateDelegationPlan([{...base,inputRefs:['attachment:A-1']}],{availableInputRefs:allowed});assert.equal(missingProject.valid,false);assert.match(missingProject.issues.join(' '),/申请 Project 访问时必须通过 inputRefs 显式选择至少一个项目/);
  const unknown=validateDelegationPlan([{...base,inputRefs:['project:9']}],{availableInputRefs:allowed});assert.equal(unknown.valid,false);assert.match(unknown.issues.join(' '),/不存在的 Task Input：project:9/);
  assert.ok(ROOT_RESPONSE_CONTRACT.properties.delegations.items.required.includes('inputRefs'));assert.ok(ROOT_RESPONSE_CONTRACT.properties.delegations.items.required.includes('networkAccess'));assert.deepEqual(ROOT_RESPONSE_CONTRACT.properties.delegations.items.properties.projectAccess.enum,['none','read','write']);
});

test('SubagentRuntime passes only selected inputs and does not run the Validator source ledger itself',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-subagent-scope-'));
  try{
    const task=taskFixture(dir);const seen={};let sourceChecks=0;
    const executor={async runSubagent({task}){seen.executor=task;return{delegationId:'spoofed',result:'ok',evidence:[],claims:[{id:'unauthorized'}],gaps:[{id:'unauthorized'}],recommendations:[{id:'unauthorized'}],gateway:{question:'unauthorized'},discoveries:[],blocker:null,uncertainty:null};}};
    const modelRouter={prepare:async()=>{},route:()=>({})};
    const sourceTraceVerifier={enforce(){sourceChecks+=1;throw new Error('ordinary source verification belongs to Validator');}};
    const runtime=new SubagentRuntime({executor,modelRouter,sourceTraceVerifier});
    const result=await runtime.run(task,{id:'w',title:'局部',goal:'只查B',expectedOutput:'结果',stopCondition:'完成',projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:1','attachment:A-2']});
    assert.deepEqual(seen.executor.projectScopes.map(x=>x.label),['B']);assert.deepEqual(seen.executor.attachments.map(x=>x.id),['A-2']);assert.deepEqual(seen.executor.references,[]);assert.equal(seen.executor.instruction,'');
    assert.equal(sourceChecks,0,'Subagent does not become its own provenance Validator');
    assert.equal(result.delegationId,'w','Work Unit identity is Runtime-owned');for(const forbidden of ['claims','gaps','recommendations','gateway','discoveries','uncertainty'])assert.equal(forbidden in result,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Validator rejects Root-authored Project/Attachment Evidence that did not arrive through Work input',()=>{
  const sourceTraceVerifier={enforce:({evidence})=>({evidence,actions:[],verifications:[]})};
  const validator=new ValidatorRuntime({sourceTraceVerifier});
  const candidate={kind:'delegate',summary:'x',finalResult:null,resultMode:'analysis',evidence:[
    {id:'E-P',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'project fact',basis:'source',locator:'A.java#L1',observation:'project fact'},
    {id:'E-A',strength:'direct',kind:'fact',sourceType:'attachment_text',coverage:'component',statement:'attachment fact',basis:'source',locator:'A-1',observation:'attachment fact'},
  ],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};
  const reviewed=validator.reviewRoot({decision:candidate,task:{id:'T'}});
  assert.equal(reviewed.outcome,'reject');
  assert.deepEqual(reviewed.decision.evidence,[]);
  assert.deepEqual(reviewed.feedback.filter(x=>x.action==='REJECT_UNOWNED_ROOT_EVIDENCE').map(x=>x.target),['evidence:E-P','evidence:E-A']);
});

test('Root may cite Project Evidence only after it arrived through completed Subagent availableEvidence',()=>{
  const sourceTraceVerifier={enforce:({evidence})=>({evidence,actions:[],verifications:[]})},validator=new ValidatorRuntime({sourceTraceVerifier});
  const evidence={id:'E-P',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'项目实现包含目标字段',basis:'source',locator:'A.java#L1',observation:'项目实现包含目标字段'};
  const candidate={kind:'delegate',summary:'x',finalResult:null,resultMode:'analysis',evidence:[],claims:[{id:'C-P',statement:'项目实现包含目标字段',level:'confirmed',evidenceIds:['E-P'],scope:'single_system',coverage:'component',hops:[],obligationRefs:[]}],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};
  const reviewed=validator.reviewRoot({decision:candidate,task:{id:'T'},availableEvidence:[evidence]});
  assert.equal(reviewed.outcome,'pass');assert.deepEqual(reviewed.decision.evidence.map(x=>x.id),['E-P']);assert.deepEqual(reviewed.decision.claims.map(x=>x.id),['C-P']);
});
