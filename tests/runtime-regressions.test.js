import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { ModelRouter } from '../src/core/model-router.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { Scheduler } from '../src/core/scheduler.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { TaskStatus, ReadyReason } from '../src/core/types.js';

function executionComplete(result='done'){
  return {kind:'complete',summary:'done',stageResult:'done',progressCommits:[],finalResult:result,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[]};
}

function analysisComplete(overrides={}){
  return {kind:'complete',summary:'candidate',stageResult:null,progressCommits:[],finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[],...overrides};
}

function rig(executor,{taskConcurrency=2,taskMaxSubagents=3,retryDelaysMs=[1,1,1,1],governance=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'taskboard-v060-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));
  const repo=new JsonTaskRepository(db);
  const service=new TaskService(repo);
  const router=new ModelRouter();
  const analysisValidator=governance?new AnalysisResultValidator():null;
  const validatorRuntime=analysisValidator?new ValidatorRuntime({analysisValidator}):null;
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime,governanceCompiler:governance?new GovernanceCompiler({rootDir:resolve('.')}):null,maxConcurrentSubagents:taskMaxSubagents,retryDelaysMs});
  const scheduler=new Scheduler({repository:repo,taskService:service,rootRuntime:root,maxConcurrentTasks:taskConcurrency,retryDelaysMs,intervalMs:999999});
  return {dir,db,repo,service,root,scheduler,close(){scheduler.stop();db.close();rmSync(dir,{recursive:true,force:true});}};
}

async function waitUntil(predicate,{tries=100,delay=2}={}){
  for(let i=0;i<tries;i++){if(predicate())return true;await new Promise(r=>setTimeout(r,delay));}
  return false;
}

test('resource-backed admission keeps a Task READY until a real Root execution starts',async()=>{
  let signalStart,resolveRoot,entered=false;
  const executor={
    async runRoot({onExecutionStarted}){entered=true;signalStart=onExecutionStarted;return new Promise(resolve=>{resolveRoot=()=>resolve(executionComplete());});},
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor,{taskConcurrency:1});
  try{
    const task=x.scheduler.createTask({title:'admission',instruction:'run'});
    const tick=x.scheduler.tick();
    assert.equal(await waitUntil(()=>entered),true);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.READY,'claiming/attempting a Root is not RUNNING yet');
    signalStart();
    assert.equal(await waitUntil(()=>x.service.getTask(task.id).status===TaskStatus.RUNNING),true);
    resolveRoot();await tick;
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});

test('Root capacity shortage never allocates the Task and does not consume the 1/5 failure budget',async()=>{
  const executor={
    async runRoot(){const error=new Error('no available agent capacity');error.capacityUnavailable=true;throw error;},
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor,{taskConcurrency:1});
  try{
    const task=x.scheduler.createTask({title:'no root',instruction:'run'});
    const enteredAt=task.status_entered_at;
    await x.scheduler.tick();
    const current=x.service.getTask(task.id);
    assert.equal(current.status,TaskStatus.READY);
    assert.equal(current.ready_reason,ReadyReason.WAITING_RESOURCE);
    assert.equal(current.executionState.retry.scope,'root-capacity');
    assert.equal(current.executionState.retry.failureCount,0);
    assert.equal(current.status_entered_at,enteredAt,'READY metadata/capacity updates must not rewrite the current-status entry time');
    assert.equal(x.service.counts().RUNNING,0);
  }finally{x.close();}
});

test('Subagent capacity shortage remains WAITING_RESOURCE with zero failures and returns the Task to READY when nobody is executing',async()=>{
  let rootCalls=0;
  const executor={
    async runRoot({onExecutionStarted}){rootCalls++;onExecutionStarted?.();return {kind:'delegate',summary:'delegate',stageResult:null,progressCommits:[],finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[{id:'w',title:'work',instruction:'work',goal:'work',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]}]};},
    async runSubagent(){const error=new Error('server overloaded; retry later');error.capacityUnavailable=true;throw error;},
  };
  const x=rig(executor,{taskConcurrency:1,taskMaxSubagents:3});
  try{
    const task=x.scheduler.createTask({title:'Subagent capacity',instruction:'run'});
    await x.scheduler.tick();
    const current=x.service.getTask(task.id);
    assert.equal(rootCalls,1);
    assert.equal(current.status,TaskStatus.READY);
    assert.equal(current.ready_reason,ReadyReason.WAITING_RESOURCE);
    const unit=x.root.snapshot(task.id).stage.workUnits[0];
    assert.equal(unit.status,'WAITING_RESOURCE');
    assert.equal(unit.failureCount,0);
  }finally{x.close();}
});

test('lowering task concurrency never preempts running Tasks; it only stops replenishment until active execution naturally drains',async()=>{
  const releases=[];let starts=0;
  const executor={
    async runRoot({onExecutionStarted}){starts++;onExecutionStarted?.();return new Promise(resolve=>releases.push(()=>resolve(executionComplete())));},
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor,{taskConcurrency:3});
  try{
    for(let i=0;i<4;i++)x.scheduler.createTask({title:`T${i}`,instruction:'run'});
    const firstTick=x.scheduler.tick();
    assert.equal(await waitUntil(()=>starts===3),true);
    assert.equal(x.service.counts().RUNNING,3);
    assert.equal(x.service.counts().READY,1);
    x.scheduler.setConcurrency(1);
    releases.shift()();await waitUntil(()=>x.service.counts().RUNNING===2);
    await x.scheduler.tick();assert.equal(starts,3,'while active count exceeds the new limit, no new Root may be allocated');
    releases.shift()();await waitUntil(()=>x.service.counts().RUNNING===1);
    await x.scheduler.tick();assert.equal(starts,3,'at the limit, no extra Task is replenished');
    releases.shift()();await firstTick;
    const secondTick=x.scheduler.tick();
    assert.equal(await waitUntil(()=>starts===4),true,'after natural drain below the limit, the READY Task may start');
    releases.shift()();await secondTick;
    assert.equal(x.service.counts().COMPLETED,4);
  }finally{x.close();}
});

test('per-Task Subagent limit is a per-Root Subagent ceiling, not a global shared pool',async()=>{
  const releases=[];const activeByTask=new Map();let totalActive=0,maxTotal=0;
  const executor={
    async runRoot({task,subagentResults,onExecutionStarted}){onExecutionStarted?.();if(!subagentResults.length)return {kind:'delegate',summary:'split',stageResult:null,progressCommits:[],finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[1,2,3].map(n=>({id:`${task.id}-${n}`,title:`W${n}`,instruction:'work',goal:'work',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]}))};return executionComplete();},
    async runSubagent({task,delegation,onExecutionStarted}){onExecutionStarted?.();totalActive++;maxTotal=Math.max(maxTotal,totalActive);activeByTask.set(task.id,(activeByTask.get(task.id)||0)+1);return new Promise(resolve=>releases.push(()=>{totalActive--;activeByTask.set(task.id,activeByTask.get(task.id)-1);resolve({delegationId:delegation.id,result:'done',evidence:[],claims:[],gaps:[],recommendations:[],blocker:null,uncertainty:null});}));},
  };
  const x=rig(executor,{taskConcurrency:2,taskMaxSubagents:3});
  try{
    x.scheduler.createTask({title:'A',instruction:'run'});x.scheduler.createTask({title:'B',instruction:'run'});
    const tick=x.scheduler.tick();
    assert.equal(await waitUntil(()=>maxTotal===6),true,'two Roots may each use three Subagents when the executor actually supplies them');
    assert.deepEqual([...activeByTask.values()].sort(),[3,3]);
    releases.splice(0).forEach(fn=>fn());await tick;
    assert.equal(x.service.counts().COMPLETED,2);
  }finally{x.close();}
});

test('lowering per-Root maximum Subagents uses natural convergence and never aborts already running Subagents',async()=>{
  const releases=[];let workerStarts=0;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){onExecutionStarted?.();if(!subagentResults.length)return {kind:'delegate',summary:'split',stageResult:null,progressCommits:[],finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[1,2,3,4,5].map(n=>({id:`w${n}`,title:`W${n}`,instruction:'work',goal:'work',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]}))};return executionComplete();},
    async runSubagent({delegation,onExecutionStarted}){onExecutionStarted?.();workerStarts++;return new Promise(resolve=>releases.push(()=>resolve({delegationId:delegation.id,result:'done',evidence:[],claims:[],gaps:[],recommendations:[],blocker:null,uncertainty:null})));},
  };
  const x=rig(executor,{taskConcurrency:1,taskMaxSubagents:5});
  try{
    const task=x.scheduler.createTask({title:'natural threads',instruction:'run'});const tick=x.scheduler.tick();
    assert.equal(await waitUntil(()=>workerStarts===5),true);
    x.root.setConcurrency(2);
    releases.shift()();await waitUntil(()=>x.root.snapshot(task.id).stage.workUnits.filter(u=>u.status==='RUNNING').length===4);
    assert.equal(workerStarts,5,'lowering the ceiling must not create replacements or abort existing Subagents');
    releases.shift()();releases.shift()();await waitUntil(()=>x.root.snapshot(task.id).stage.workUnits.filter(u=>u.status==='RUNNING').length===2);
    assert.equal(workerStarts,5);
    releases.splice(0).forEach(fn=>fn());await tick;
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});

test('validated analysis knowledge creates History even when Root returns no progressCommits',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-history-source-'));
  const attachment=join(dir,'requirements.txt');
  writeFileSync(attachment,'附件规定 OA→ERP 为现有逻辑\n');
  const executor={
    async runRoot({onExecutionStarted}){onExecutionStarted?.();return analysisComplete({
      evidence:[{id:'E-1',strength:'direct',kind:'requirement',sourceType:'reference',coverage:'source',statement:'附件规定 OA→ERP 为现有逻辑',basis:'referenced result',locator:'Referenced completed Result',observation:'附件规定 OA→ERP 为现有逻辑'}],
      claims:[{id:'C-1',statement:'附件规定 OA→ERP 为现有逻辑',level:'confirmed',evidenceIds:['E-1'],scope:'single_system',coverage:'source',hops:[]}],
      steps:[{order:1,text:'附件规定 OA→ERP 为现有逻辑',kind:'confirmed',sourceIds:['C-1']}],
      progressCommits:[],
    });},
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor,{governance:true});const commits=[];
  try{
    const outcome=await x.root.execute({id:'H-1',title:'OA需求分析',instruction:'根据附件分析',projectScopes:[],attachments:[],references:[{source_task_id:'REF-1',title:'已确认需求',final_result:'附件规定 OA→ERP 为现有逻辑'}]},{onProgressCommit:c=>commits.push(c)});
    assert.equal(outcome.kind,'complete');
    assert.deepEqual(commits,[{title:'阶段事实已确认',detail:'附件规定 OA→ERP 为现有逻辑',completedAt:commits[0].completedAt}]);
  }finally{x.close();rmSync(dir,{recursive:true,force:true});}
});


test('analysis publication does not invoke a second model grounding turn',async()=>{
  let rootCalls=0,groundingCalls=0;
  const executor={
    async runRoot({onExecutionStarted}){
      rootCalls++;onExecutionStarted?.();
      return analysisComplete({
        evidence:[{id:'E-1',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'ATTRIBUTE1 = person.getFdNo()',basis:'Code',locator:'Code:1',observation:'ATTRIBUTE1 = person.getFdNo()'}],
        claims:[{id:'C-1',statement:'ATTRIBUTE1 保存当前分支选定人员的 fdNo',level:'confirmed',evidenceIds:['E-1'],scope:'single_system',coverage:'component',hops:[]}],
        steps:[{order:1,text:'ATTRIBUTE1 保存当前分支选定人员的 fdNo',kind:'confirmed',sourceIds:['C-1']}],
      });
    },
    async verifyAnalysisGrounding(){groundingCalls++;throw new Error('post-hoc grounding must not run');},
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor,{governance:true});
  try{
    const outcome=await x.root.execute({id:'NO-GROUNDING',title:'analysis',instruction:'analyze',projectScopes:[],attachments:[],references:[]});
    assert.equal(outcome.kind,'complete');
    assert.equal(rootCalls,1);
    assert.equal(groundingCalls,0,'publication must not add a second semantic-review model turn');
  }finally{x.close();}
});

test('direct attachment requirement collected by Subagent is not downgraded by a post-hoc partial-evidence reviewer',async()=>{
  let groundingCalls=0,rootCalls=0;
  const dir=mkdtempSync(join(tmpdir(),'taskboard-direct-attachment-'));
  const attachment=join(dir,'requirements.txt');
  const statement='步骤1要求内部备注必填、外部备注自动生成且不可修改，完成后 OA 推送 ERP。';
  writeFileSync(attachment,`${statement}\n`);
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      rootCalls++;onExecutionStarted?.();
      if(!subagentResults.length)return analysisComplete({kind:'delegate',summary:'提取附件原文',delegations:[{id:'WU-REQ',title:'提取附件需求',goal:'提取步骤1原文',expectedOutput:'返回可追溯附件证据',stopCondition:'步骤1原文已提取后停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['attachment:A-1']}]});
      return analysisComplete({
        evidence:[],
        claims:[{id:'C-STEP1',statement,level:'confirmed',evidenceIds:['E-TEXT','E-VIS'],scope:'single_system',coverage:'source',hops:[]}],
        steps:[{order:1,text:statement,kind:'confirmed',sourceIds:['C-STEP1']}],
      });
    },
    async runSubagent({delegation,onExecutionStarted}){onExecutionStarted?.();return{delegationId:delegation.id,result:'已提取',evidence:[
      {id:'E-TEXT',strength:'direct',kind:'requirement',sourceType:'attachment_text',coverage:'source',statement,basis:'附件步骤1正文',locator:'requirements.txt#L1',observation:statement},
      {id:'E-VIS',strength:'indirect',kind:'requirement',sourceType:'attachment_visual',coverage:'source',statement:'原型显示内部备注必填、外部备注只读',basis:'附件原型',locator:'requirements.txt#原型',observation:'原型显示内部备注必填、外部备注只读'},
    ],findings:[],discoveries:[],blocker:null,uncertainty:null};},
    async verifyAnalysisGrounding(){groundingCalls++;throw new Error('must not run');},
  };
  const x=rig(executor,{governance:true});
  try{
    const outcome=await x.root.execute({id:'REQ-1',title:'需求分析',instruction:'根据附件给出步骤',projectScopes:[],attachments:[{id:'A-1',name:'requirements.txt',path:attachment}],references:[]});
    assert.equal(outcome.kind,'complete');
    assert.equal(rootCalls,2);
    assert.equal(groundingCalls,0);
    assert.match(outcome.finalResult,/^1\. 步骤1要求/m);
    assert.doesNotMatch(outcome.finalResult,/请确认：步骤1要求/);
  }finally{x.close();rmSync(dir,{recursive:true,force:true});}
});

test('waiting Subagent retries capacity while sibling work is still running so available resources are used promptly',async()=>{
  let firstRelease;let subagent2Attempts=0;let subagent2Started=false;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      onExecutionStarted?.();
      if(!subagentResults.length)return {kind:'delegate',summary:'split',stageResult:null,progressCommits:[],finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[{id:'w1',title:'long',instruction:'long',goal:'long',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]},{id:'w2',title:'capacity',instruction:'capacity',goal:'capacity',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]}]};
      return executionComplete();
    },
    async runSubagent({delegation,onExecutionStarted}){
      if(delegation.id==='w1'){
        onExecutionStarted?.();
        return new Promise(resolve=>{firstRelease=()=>resolve({delegationId:'w1',result:'done',evidence:[],claims:[],gaps:[],recommendations:[],blocker:null,uncertainty:null});});
      }
      subagent2Attempts++;
      if(subagent2Attempts===1){const error=new Error('no available worker capacity');error.capacityUnavailable=true;throw error;}
      onExecutionStarted?.();subagent2Started=true;
      return {delegationId:'w2',result:'done',evidence:[],claims:[],gaps:[],recommendations:[],blocker:null,uncertainty:null};
    },
  };
  const x=rig(executor,{taskConcurrency:1,taskMaxSubagents:2,retryDelaysMs:[1,1,1,1]});
  try{
    const task=x.scheduler.createTask({title:'capacity refill',instruction:'run'});const tick=x.scheduler.tick();
    assert.equal(await waitUntil(()=>subagent2Attempts===1&&Boolean(firstRelease),{tries:100,delay:5}),true);
    assert.equal(subagent2Started,false);
    assert.equal(await waitUntil(()=>subagent2Started,{tries:320,delay:5}),true,'capacity waiting work must retry without waiting for the long sibling to finish');
    assert.equal(subagent2Attempts,2);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.RUNNING);
    firstRelease();await tick;
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});

test('Executor must report a real start before a terminal outcome can allocate a Task',async()=>{
  const executor={
    async runRoot(){return executionComplete('should not publish');},
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor,{taskConcurrency:1});
  const originalError=console.error;console.error=()=>{};
  try{
    const task=x.scheduler.createTask({title:'adapter contract',instruction:'run'});
    await x.scheduler.tick();
    const current=x.service.getTask(task.id);
    assert.equal(current.status,TaskStatus.READY);
    assert.equal(current.ready_reason,ReadyReason.SUSPENDED);
    assert.equal(current.final_result,null);
    assert.equal(x.service.counts().RUNNING,0);
    assert.match(String(current.executionState?.snapshot?.stage?.workUnits?.[0]?.detail||''),/EXECUTOR_START_NOT_REPORTED/);
  }finally{console.error=originalError;x.close();}
});
