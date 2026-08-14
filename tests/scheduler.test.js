import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { ModelRouter } from '../src/core/model-router.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { Scheduler } from '../src/core/scheduler.js';
import { MockExecutor } from '../src/extensions/executors/mock/mock-executor.js';
import { TaskStatus, ReadyReason, CompletionReason, WorkUnitStatus } from '../src/core/types.js';

function rig(executor=new MockExecutor(),{maxConcurrentSubagents=4,retryDelaysMs=[0,0,0,0]}={}){const dir=mkdtempSync(join(tmpdir(),'taskboard-scheduler-'));const db=new JsonTaskDatabase(join(dir,'db.json'));const repo=new JsonTaskRepository(db);const service=new TaskService(repo);const router=new ModelRouter();const subagent=new SubagentRuntime({executor,modelRouter:router});const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,maxConcurrentSubagents,retryDelaysMs});const scheduler=new Scheduler({repository:repo,taskService:service,rootRuntime:root,intervalMs:999999,retryDelaysMs});return{dir,db,repo,service,root,scheduler,close(){scheduler.stop();db.close();rmSync(dir,{recursive:true,force:true});}};}
const complete=(result='done')=>({kind:'complete',summary:'ok',stageResult:'ok',finalResult:result,confirmed:[],recommendations:[],openQuestions:[],gateway:null,delegations:[]});

test('Scheduler owns Human Gateway state transition and resumes only after answer',async()=>{const x=rig();try{const task=x.scheduler.createTask({title:'做一个 OA 系统',instruction:'你帮我做了吧'});await x.scheduler.tick();assert.equal(x.service.getTask(task.id).status,TaskStatus.WAITING_HUMAN);x.scheduler.answerHumanGateway(task.id,'基础办公');assert.equal(x.service.getTask(task.id).status,TaskStatus.READY);await x.scheduler.tick();assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);}finally{x.close();}});


test('Scheduler keeps Tasks in READY while the executor runtime is being prepared, then claims automatically when ready',async()=>{
  let ready=false,calls=0;
  const executor={
    readiness(){return ready?{ready:true,preparing:false}:{ready:false,preparing:true,message:'Codex 执行组件正在后台准备，无需操作。'};},
    async runRoot({onExecutionStarted}){calls++;onExecutionStarted?.();return complete('runtime ready');},
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'运行时准备',instruction:'等待执行器'});
    await x.scheduler.tick();
    assert.equal(calls,0);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.READY);
    const activity=x.scheduler.getTaskActivity(task.id);
    assert.equal(activity.summary,'等待执行资源');
    assert.match(activity.detail,/无需操作/);
    ready=true;
    await x.scheduler.tick();
    assert.equal(calls,1);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});

test('retryable failures are hard-capped at five total attempts; first failure is 1/5 and sixth attempt cannot occur',async()=>{let calls=0;const executor={async runRoot(){calls++;throw new Error('temporary network connection failure');},async runSubagent(){throw new Error('unused');}};const x=rig(executor);try{const task=x.scheduler.createTask({title:'重试上限',instruction:'测试'});for(let i=0;i<8;i++)await x.scheduler.tick();const current=x.service.getTask(task.id);assert.equal(calls,5);assert.equal(current.status,TaskStatus.READY);assert.equal(current.ready_reason,ReadyReason.SUSPENDED);assert.equal(current.executionState.retry.failureCount,5);assert.equal(current.executionState.retry.paused,true);await x.scheduler.tick();assert.equal(calls,5,'failure_count >= 5 must block any sixth automatic attempt');}finally{x.close();}});

test('retryable transport failure is RETRY_WAIT and remains visibly distinct from resource wait after activity memory is lost',async()=>{
  let calls=0;
  const executor={async runRoot(){calls++;throw new Error('stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)');},async runSubagent(){throw new Error('unused');}};
  const x=rig(executor,{retryDelaysMs:[5_000,5_000,5_000,5_000]});
  try{
    const task=x.scheduler.createTask({title:'断流重试',instruction:'测试'});
    await x.scheduler.tick();
    const current=x.service.getTask(task.id);
    assert.equal(calls,1);
    assert.equal(current.status,TaskStatus.READY);
    assert.equal(current.ready_reason,ReadyReason.RETRY_WAIT);
    assert.equal(current.executionState.snapshot.stage.workUnits[0].status,WorkUnitStatus.RETRY_WAIT);
    x.scheduler.activities.delete(task.id); // simulate process/activity-memory loss while durable state remains
    const activity=x.scheduler.getTaskActivity(task.id);
    assert.equal(activity.summary,'等待自动重试');
    assert.match(activity.detail,/Codex 流式连接中断|第 1 次执行未成功/);
  }finally{x.close();}
});

test('current stage keeps all Work Units visible while Subagent activity and Root-authored history hints stay non-durable',async()=>{let secondRelease;const executor={async runRoot({subagentResults,onExecutionStarted}){onExecutionStarted?.();if(!subagentResults.length)return{kind:'delegate',summary:'拆分',stageResult:null,progressCommits:[],finalResult:null,confirmed:[],recommendations:[],openQuestions:[],gateway:null,delegations:[{id:'a',title:'附件事实',instruction:'A',goal:'A',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]},{id:'b',title:'项目证据',instruction:'B',goal:'B',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]},{id:'c',title:'实施步骤',instruction:'C',goal:'C',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]},{id:'d',title:'事实边界检查',instruction:'D',goal:'D',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]}]};return{...complete(),progressCommits:[{title:'阶段证据已收敛',detail:'附件事实、项目证据、实施步骤和事实边界已由 Root 聚合确认。'}]};},async runSubagent({delegation,onExecutionStarted}){onExecutionStarted?.();if(delegation.id==='a')return{delegationId:'a',result:'附件已完成',findings:[],recommendations:[],openQuestions:[],blocker:null,uncertainty:null};if(delegation.id==='b')return new Promise(resolve=>{secondRelease=()=>resolve({delegationId:'b',result:'项目完成',findings:[],recommendations:[],openQuestions:[],blocker:null,uncertainty:null});});return{delegationId:delegation.id,result:'done',findings:[],recommendations:[],openQuestions:[],blocker:null,uncertainty:null};}};const x=rig(executor,{maxConcurrentSubagents:1});try{const task=x.scheduler.createTask({title:'并行进展',instruction:'分析'});const tick=x.scheduler.tick();for(let i=0;i<100;i++){const activity=x.scheduler.getTaskActivity(task.id);const units=activity?.current?.stage?.workUnits||[];if(units.some(u=>u.id==='a'&&u.status==='COMPLETED')&&units.some(u=>u.id==='b'&&u.status==='RUNNING')){assert.equal(units.length,4);assert.equal(units.find(u=>u.id==='b').owner,'subagent');assert.equal(units.find(u=>u.id==='c').owner,null);assert.equal(units.find(u=>u.id==='c').status,'WAITING_RESOURCE');assert.equal(units.find(u=>u.id==='d').status,'WAITING_RESOURCE');break;}await new Promise(r=>setTimeout(r,5));}assert.equal(x.service.getTask(task.id).status,TaskStatus.RUNNING);assert.equal(x.service.progressHistory(task.id).length,0,'Subagent activity is not durable history before Root accepts a knowledge boundary');secondRelease();await tick;assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);assert.equal(x.service.progressHistory(task.id).length,0,'execution-mode Root history hints are not persistence authority');}finally{x.close();}});

test('dependency wait is distinct from resource wait',async()=>{let release;const executor={async runRoot({subagentResults,onExecutionStarted}){onExecutionStarted?.();if(!subagentResults.length)return{kind:'delegate',summary:'deps',stageResult:null,finalResult:null,confirmed:[],recommendations:[],openQuestions:[],gateway:null,delegations:[{id:'a',title:'附件事实',instruction:'A',goal:'A',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]},{id:'b',title:'实施步骤',instruction:'B',goal:'B',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:['a']}]};return complete();},async runSubagent({delegation,onExecutionStarted}){onExecutionStarted?.();if(delegation.id==='a')return new Promise(resolve=>{release=()=>resolve({delegationId:'a',result:'A done',findings:[],recommendations:[],openQuestions:[],blocker:null,uncertainty:null});});return{delegationId:'b',result:'B done',findings:[],recommendations:[],openQuestions:[],blocker:null,uncertainty:null};}};const x=rig(executor,{maxConcurrentSubagents:2});try{const task=x.scheduler.createTask({title:'依赖',instruction:'测试'});const tick=x.scheduler.tick();for(let i=0;i<50;i++){const units=x.scheduler.getTaskActivity(task.id)?.current?.stage?.workUnits||[];if(units.length){assert.equal(units.find(u=>u.id==='a').status,'RUNNING');assert.equal(units.find(u=>u.id==='b').status,'WAITING_DEPENDENCY');break;}await new Promise(r=>setTimeout(r,5));}release();await tick;assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);}finally{x.close();}});

test('cancel of RUNNING is an intent; Root quiesces first and only Scheduler moves Task to COMPLETED/CANCELLED',async()=>{let started=false;const executor={async runRoot({signal,onExecutionStarted}){started=true;onExecutionStarted?.();return new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{const e=new Error('interrupted');e.interrupted=true;reject(e);},{once:true});});},async runSubagent(){throw new Error('unused');}};const x=rig(executor);try{const task=x.scheduler.createTask({title:'取消运行',instruction:'执行'});const tick=x.scheduler.tick();for(let i=0;i<50&&!started;i++)await new Promise(r=>setTimeout(r,5));assert.equal(x.service.getTask(task.id).status,TaskStatus.RUNNING);const requested=x.scheduler.requestCancel(task.id);assert.equal(requested.pending,true);await tick;const done=x.service.getTask(task.id);assert.equal(done.status,TaskStatus.COMPLETED);assert.equal(done.completion_reason,CompletionReason.CANCELLED);assert.equal(done.cancel_requested_at,null);}finally{x.close();}});



test('cancel waits for an active Subagent promise to settle before Scheduler marks the Task completed',async()=>{
  let workerStarted=false;let workerSettled=false;
  const executor={
    async runRoot({subagentResults}){
      if(!subagentResults.length)return{kind:'delegate',summary:'delegate',stageResult:null,finalResult:null,confirmed:[],recommendations:[],openQuestions:[],gateway:null,delegations:[{id:'slow',title:'慢任务',instruction:'work',goal:'work',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]}]};
      return complete();
    },
    async runSubagent({signal,onExecutionStarted}){
      workerStarted=true;
      onExecutionStarted?.();
      return new Promise((resolve,reject)=>{
        signal.addEventListener('abort',()=>setTimeout(()=>{workerSettled=true;const e=new Error('interrupted');e.interrupted=true;reject(e);},40),{once:true});
      });
    },
  };
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'等待 Subagent 收尾',instruction:'执行'});
    const tick=x.scheduler.tick();
    for(let i=0;i<100&&!workerStarted;i++)await new Promise(r=>setTimeout(r,2));
    assert.equal(workerStarted,true);
    const requested=x.scheduler.requestCancel(task.id);
    assert.equal(requested.pending,true);
    await new Promise(r=>setTimeout(r,10));
    assert.equal(workerSettled,false);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.RUNNING,'Task must not enter COMPLETED before the active Subagent settles');
    await tick;
    assert.equal(workerSettled,true);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
    assert.equal(x.service.getTask(task.id).completion_reason,CompletionReason.CANCELLED);
  }finally{x.close();}
});

test('WAITING_HUMAN is quiescent, so Scheduler can cancel it directly into COMPLETED/CANCELLED',async()=>{const x=rig();try{const task=x.scheduler.createTask({title:'做一个 OA 系统',instruction:'你帮我做了吧'});await x.scheduler.tick();assert.equal(x.service.getTask(task.id).status,TaskStatus.WAITING_HUMAN);const result=x.scheduler.requestCancel(task.id);assert.equal(result.pending,false);assert.equal(result.task.status,TaskStatus.COMPLETED);assert.equal(result.task.completion_reason,CompletionReason.CANCELLED);}finally{x.close();}});

test('internal non-convergence never fabricates Human Gateway',async()=>{let rounds=0;const executor={async runRoot(){rounds++;return{kind:'delegate',summary:'more',stageResult:null,finalResult:null,confirmed:[],recommendations:[],openQuestions:[],gateway:null,delegations:[{id:`d${rounds}`,title:'inspect',instruction:'read',goal:'read',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]}]};},async runSubagent({delegation}){return{delegationId:delegation.id,result:'finding',findings:[],recommendations:[],openQuestions:[],blocker:null,uncertainty:null};}};const x=rig(executor);try{const task=x.scheduler.createTask({title:'内部收敛',instruction:'自行分析'});await x.scheduler.tick();const current=x.service.getTask(task.id);assert.equal(rounds,6,'the first bounded Work Unit runs once; repeated semantic re-issuance is then rejected through the normal planning-repair cycle');assert.equal(current.status,TaskStatus.READY);assert.equal(current.pendingGateway,null);assert.equal(current.ready_reason,ReadyReason.SUSPENDED);assert.equal(current.executionState.retry.failureCount,1,'deterministic first failure must remain 1/5, not be inflated to the retry cap');}finally{x.close();}});

test('manual retry of a suspended work unit starts a fresh 1/5 failure cycle',async()=>{
  let rootCalls=0,subagentCalls=0;
  const executor={
    async runRoot(){rootCalls++;return{kind:'delegate',summary:'work',stageResult:null,finalResult:null,confirmed:[],recommendations:[],openQuestions:[],gateway:null,delegations:[{id:'evidence',title:'项目证据',instruction:'inspect',goal:'inspect',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]}]};},
    async runSubagent(){subagentCalls++;throw new Error('temporary network connection failure');},
  };
  const x=rig(executor,{retryDelaysMs:[0,0,0,0]});
  try{
    const task=x.scheduler.createTask({title:'手动重试',instruction:'测试'});
    await x.scheduler.tick();
    const suspended=x.service.getTask(task.id);
    assert.equal(subagentCalls,5);assert.equal(suspended.ready_reason,ReadyReason.SUSPENDED);
    const before=x.root.snapshot(task.id);assert.equal(before.stage.workUnits[0].failureCount,5);assert.equal(before.stage.workUnits[0].status,'SUSPENDED');
    // Keep this test focused on resetting the retry cycle; do not let the
    // scheduler immediately claim the task again in the background.
    x.scheduler.tick=async()=>{};
    const retried=x.scheduler.retryTask(task.id,'evidence');
    assert.equal(retried.ready_reason,ReadyReason.WAITING_RESOURCE);
    const after=x.root.snapshot(task.id);assert.equal(after.stage.workUnits[0].failureCount,0);assert.equal(after.stage.workUnits[0].status,'WAITING_RESOURCE');assert.match(after.stage.workUnits[0].detail,/第 1\/5 次/);
  }finally{x.close();}
});

test('process shutdown interrupts execution without converting the Task into user cancellation or writing retry state',async()=>{
  let started=false;
  const executor={
    async runRoot({signal,onExecutionStarted}){
      started=true;
      onExecutionStarted?.();
      return new Promise((resolve,reject)=>{
        signal.addEventListener('abort',()=>{const e=new Error('server shutdown');e.interrupted=true;reject(e);},{once:true});
      });
    },
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'进程关闭恢复',instruction:'执行'});
    const running=x.scheduler.tick();
    for(let i=0;i<100&&!started;i++)await new Promise(r=>setTimeout(r,2));
    assert.equal(x.service.getTask(task.id).status,TaskStatus.RUNNING);
    x.scheduler.beginShutdown();
    assert.equal(await x.scheduler.waitForIdle(500),true);
    await running;
    const persisted=x.service.getTask(task.id);
    assert.equal(persisted.status,TaskStatus.RUNNING,'shutdown must leave lifecycle state for startup recovery');
    assert.equal(persisted.completion_reason,null);
    assert.equal(persisted.cancel_requested_at,null);
    assert.equal(persisted.executionState,null,'shutdown must not fabricate an execution failure/retry cycle');
    const recovered=x.scheduler.recoverStaleRunningTasks();
    assert.equal(recovered,1);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.READY);
    assert.equal(x.service.getTask(task.id).ready_reason,ReadyReason.WAITING_RESOURCE);
  }finally{x.close();}
});

test('bounded shutdown remains safe when an executor ignores abort and resolves after the shutdown wait expires',async()=>{
  let started=false;let resolveRoot;
  const executor={
    async runRoot({onExecutionStarted}){
      started=true;
      onExecutionStarted?.();
      return new Promise(resolve=>{resolveRoot=()=>resolve(complete('late result that must be discarded'));});
    },
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'忽略中断的执行器',instruction:'验证关闭边界'});
    const running=x.scheduler.tick();
    for(let i=0;i<100&&!started;i++)await new Promise(r=>setTimeout(r,2));
    assert.equal(started,true);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.RUNNING);
    x.scheduler.beginShutdown();
    assert.equal(await x.scheduler.waitForIdle(20),false,'bounded shutdown must be allowed to time out instead of waiting forever');
    const before=x.service.getTask(task.id);
    const beforeHistory=x.service.progressHistory(task.id).length;
    resolveRoot();
    await running;
    const after=x.service.getTask(task.id);
    assert.equal(after.status,TaskStatus.RUNNING,'a late executor result must not complete the Task after shutdown begins');
    assert.equal(after.final_result,before.final_result);
    assert.equal(after.last_stage_result,before.last_stage_result);
    assert.equal(after.executionState,before.executionState);
    assert.equal(x.service.progressHistory(task.id).length,beforeHistory,'late stage callbacks must not persist after shutdown starts');
    assert.equal(x.scheduler.activeTasks.size,0);
  }finally{x.close();}
});

test('Root-authored progressCommits are ignored because History authority belongs to Validator, not Root',async()=>{
  const executor={
    async runRoot({onExecutionStarted}){onExecutionStarted?.();return{...complete('root only done'),progressCommits:[{title:'OA→ERP 证据已确认',detail:'已定位流程结束调用和内部备注、外部备注、申请人工号字段映射。'}]};},
    async runSubagent(){throw new Error('Subagent should not run');},
  };
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'Root 直接分析',instruction:'定向核对一个入口'});
    await x.scheduler.tick();
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
    const history=x.service.progressHistory(task.id);
    assert.equal(history.length,0,'Root cannot directly commit History, even when it labels process output as valuable');
  }finally{x.close();}
});

test('dependent Subagent receives completed dependency results instead of only waiting for timing',async()=>{
  let received=null;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      onExecutionStarted?.();
      if(!subagentResults.length)return{kind:'delegate',summary:'依赖拆分',stageResult:null,progressCommits:[],finalResult:null,confirmed:[],recommendations:[],openQuestions:[],gateway:null,delegations:[{id:'attachment',title:'附件事实',instruction:'读附件',goal:'读附件',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]},{id:'chain',title:'链路核验',instruction:'基于附件核验',goal:'基于附件核验',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:['attachment']}]};
      return complete('done');
    },
    async runSubagent({delegation,onExecutionStarted}){
      onExecutionStarted?.();
      if(delegation.id==='attachment')return{delegationId:'attachment',result:'附件确认 OA→ERP 为现有逻辑',findings:[],recommendations:[],openQuestions:[],blocker:null,uncertainty:null};
      received=delegation.dependencyResults;
      return{delegationId:'chain',result:'链路核验完成',findings:[],recommendations:[],openQuestions:[],blocker:null,uncertainty:null};
    },
  };
  const x=rig(executor,{maxConcurrentSubagents:2});
  try{
    const task=x.scheduler.createTask({title:'依赖结果',instruction:'核验'});
    await x.scheduler.tick();
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
    assert.equal(received.length,1);
    assert.equal(received[0].id,'attachment');
    assert.match(received[0].result.result,/OA→ERP/);
  }finally{x.close();}
});


test('Root history hints on delegation and completion never bypass Validator/Task Core authority',async()=>{
  const executor={
    async runRoot({subagentResults}){
      if(!subagentResults.length)return{kind:'delegate',summary:'先查',stageResult:'正在定位',progressCommits:[{title:'不应提交',detail:'git grep 33550 files'}],finalResult:null,confirmed:[],recommendations:[],openQuestions:[],gateway:null,delegations:[{id:'a',title:'项目证据',instruction:'查',goal:'查',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]}]};
      return{...complete('done'),progressCommits:[{title:'项目证据已确认',detail:'已确认当前 Project Scope 中的 OA→ERP 字段映射边界。'}]};
    },
    async runSubagent(){return{delegationId:'a',result:'done',findings:[],recommendations:[],openQuestions:[],blocker:null,uncertainty:null};},
  };
  const x=rig(executor);
  try{const task=x.scheduler.createTask({title:'历史门禁',instruction:'核对'});await x.scheduler.tick();const history=x.service.progressHistory(task.id);assert.equal(history.length,0,'progressCommits from Root are intentionally ignored outside Validator-certified Task knowledge');}
  finally{x.close();}
});

// Governance/runtime regression: History is produced from any certified Root
// knowledge boundary; no special checkpoint kind exists. A Root may certify new
// Task knowledge and delegate the next bounded Work Unit in the same decision.
test('Validator-certified Root knowledge is persisted to History before delegated follow-up work finishes',async()=>{
  const { resolve } = await import('node:path');
  const { GovernanceCompiler } = await import('../src/governance/governance-compiler.js');
  const { AnalysisResultValidator } = await import('../src/governance/analysis-validator.js');
  const { ValidatorRuntime } = await import('../src/governance/validator-runtime.js');
  let rootCalls=0,releaseWorker=null,workerStarted=false;
  const first={
    kind:'delegate',summary:'附件需求边界已确认，继续核对项目入口',stageResult:null,progressCommits:[{title:'Agent不应控制History',detail:'ignore',sourceIds:['C-1']}],finalResult:null,resultMode:'analysis',
    evidence:[{id:'E-1',strength:'direct',kind:'requirement',sourceType:'reference',coverage:'source',statement:'附件步骤1要求内部备注必填。',basis:'referenced result',locator:'Referenced completed Result',observation:'附件步骤1要求内部备注必填。'}],
    claims:[{id:'C-1',statement:'附件步骤1要求内部备注必填。',level:'confirmed',evidenceIds:['E-1'],scope:'general',coverage:'source',hops:[]}],
    gaps:[],recommendations:[],steps:[],gateway:null,
    delegations:[{id:'project-entry',title:'核对项目入口',goal:'核对项目入口',expectedOutput:'返回入口证据',stopCondition:'入口已确认或形成明确 Gap',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]}],
  };
  const final={...first,kind:'complete',summary:'完成',progressCommits:[],delegations:[],steps:[{order:1,text:'附件步骤1要求内部备注必填。',kind:'confirmed',sourceIds:['C-1']}]};
  const executor={
    async runRoot({onExecutionStarted}){rootCalls+=1;onExecutionStarted?.();return rootCalls===1?first:final;},
    async runSubagent({delegation,onExecutionStarted}){workerStarted=true;onExecutionStarted?.();return new Promise(resolveDone=>{releaseWorker=()=>resolveDone({delegationId:delegation.id,result:'入口核对完成',evidence:[],claims:[],gaps:[],recommendations:[],discoveries:[],blocker:null,uncertainty:null});});},
  };
  const dir=mkdtempSync(join(tmpdir(),'taskboard-live-history-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));const repo=new JsonTaskRepository(db);const service=new TaskService(repo);const router=new ModelRouter();
  const compiler=new GovernanceCompiler({rootDir:resolve('.')});const structural=new AnalysisResultValidator();const validatorRuntime=new ValidatorRuntime({analysisValidator:structural,sourceTraceVerifier:{enforce:({evidence})=>({evidence:Array.isArray(evidence)?evidence:[],actions:[],verifications:[]})}});
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,governanceCompiler:compiler,validatorRuntime});
  const scheduler=new Scheduler({repository:repo,taskService:service,rootRuntime:root,intervalMs:999999});
  try{
    const task=scheduler.createTask({title:'OA需求分析',instruction:'根据附件与项目告知具体步骤'});
    const ticking=scheduler.tick();
    for(let i=0;i<100&&!workerStarted;i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(workerStarted,true);
    assert.equal(service.getTask(task.id).status,TaskStatus.RUNNING);
    const history=service.progressHistory(task.id);
    assert.equal(history.length,1,'certified Root knowledge must be durable while the delegated follow-up Work Unit is still running');
    assert.equal(history[0].title,'阶段事实已确认');
    assert.equal(service.getTask(task.id).last_stage_result,'附件步骤1要求内部备注必填。');
    releaseWorker();
    await ticking;
    assert.equal(service.getTask(task.id).status,TaskStatus.COMPLETED);
    assert.equal(service.progressHistory(task.id).length,1,'cumulative final result must not duplicate the already committed knowledge boundary');
  }finally{scheduler.stop();db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Subagent local result reaches Root once without semantic Validator takeover while sibling keeps running',async()=>{
  const { resolve } = await import('node:path');
  const { GovernanceCompiler } = await import('../src/governance/governance-compiler.js');
  const { AnalysisResultValidator } = await import('../src/governance/analysis-validator.js');
  const { ValidatorRuntime } = await import('../src/governance/validator-runtime.js');
  let aCalls=0,releaseB=null,bStarted=false;const rootDeliveries=[];
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      onExecutionStarted?.();
      if(!subagentResults.length)return{kind:'delegate',summary:'并行核对',stageResult:null,progressCommits:[],finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[{id:'a',title:'失败证据',instruction:'核对A',goal:'核对A',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]},{id:'b',title:'可靠证据',instruction:'核对B',goal:'核对B',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]}]};
      rootDeliveries.push(...subagentResults);
      return{kind:'complete',summary:'完成',stageResult:null,progressCommits:[],finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[{id:'G-FINAL',question:'A 子任务的证据边界仍待 Root 判断。',reason:'Subagent 只返回局部证据；Root 保留未闭合边界。',kind:'missing_fact',blocking:false,evidenceIds:[]}],recommendations:[],steps:[],gateway:null,delegations:[]};
    },
    async runSubagent({delegation,onExecutionStarted}){
      onExecutionStarted?.();
      if(delegation.id==='a'){
        aCalls+=1;
        return{delegationId:'a',result:'A local',evidence:[{id:'E-A',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'无法追溯的结论',basis:'missing trace'}],findings:[{id:'F-A',statement:'候选关系',evidenceIds:['E-A']}],discoveries:[],blocker:null,uncertainty:null};
      }
      bStarted=true;
      return new Promise(resolveB=>{releaseB=()=>resolveB({delegationId:'b',result:'B reliable',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null});});
    },
  };
  const dir=mkdtempSync(join(tmpdir(),'taskboard-subagent-local-'));const db=new JsonTaskDatabase(join(dir,'db.json'));const repo=new JsonTaskRepository(db);const service=new TaskService(repo);const router=new ModelRouter();
  const compiler=new GovernanceCompiler({rootDir:resolve('.')});const structural=new AnalysisResultValidator();const validatorRuntime=new ValidatorRuntime({analysisValidator:structural});
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,governanceCompiler:compiler,validatorRuntime,maxConcurrentSubagents:2});
  const scheduler=new Scheduler({repository:repo,taskService:service,rootRuntime:root,intervalMs:999999});
  try{
    const task=scheduler.createTask({title:'并行证据分析',instruction:'根据项目核对事实'});const ticking=scheduler.tick();
    for(let i=0;i<120;i++){
      const units=scheduler.getTaskActivity(task.id)?.current?.stage?.workUnits||[];
      if(bStarted&&aCalls===1&&units.find(u=>u.id==='a')?.status===WorkUnitStatus.COMPLETED&&units.find(u=>u.id==='b')?.status===WorkUnitStatus.RUNNING)break;
      await new Promise(r=>setTimeout(r,5));
    }
    assert.equal(aCalls,1,'Subagent result is not rerun by a semantic Subagent Validator');
    assert.equal(service.getTask(task.id).status,TaskStatus.RUNNING);
    assert.equal(root.getSession(task.id).currentStage.workUnits.find(u=>u.id==='b').status,WorkUnitStatus.RUNNING);
    releaseB();await ticking;
    assert.equal(service.getTask(task.id).status,TaskStatus.COMPLETED);
    const aResult=rootDeliveries.find(r=>r.delegationId==='a');
    assert.equal(aResult.evidence[0].strength,'indirect','untraceable DIRECT evidence is deterministically narrowed before Root consumes it');
    assert.ok(Array.isArray(aResult.findings));
    assert.equal('claims' in aResult,false);
    assert.equal('gaps' in aResult,false);
  }finally{scheduler.stop();db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Root may synthesize an early Work Unit result while final completion still waits for every issued obligation',async()=>{
  let slowStarted=false,releaseSlow;const deliveries=[];
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      onExecutionStarted?.();deliveries.push(subagentResults.map(item=>item.delegationId));
      if(!subagentResults.length)return{kind:'delegate',summary:'split',stageResult:null,finalResult:null,confirmed:[],recommendations:[],openQuestions:[],gateway:null,delegations:[
        {id:'fast',title:'关键证据',goal:'取得关键证据',expectedOutput:'返回关键证据',stopCondition:'证据取得后停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},
        {id:'slow',title:'补充证据',goal:'完成已签发的补充核对',expectedOutput:'返回补充证据',stopCondition:'补充结束后停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},
      ]};
      return complete('当前结果已可综合');
    },
    async runSubagent({delegation,onExecutionStarted}){
      onExecutionStarted?.();
      if(delegation.id==='fast')return{delegationId:'fast',result:'足够',evidence:[],claims:[],gaps:[],recommendations:[],discoveries:[],blocker:null,uncertainty:null};
      slowStarted=true;return new Promise(resolve=>{releaseSlow=()=>resolve({delegationId:'slow',result:'补充完成',evidence:[],claims:[],gaps:[],recommendations:[],discoveries:[],blocker:null,uncertainty:null});});
    },
  };
  const x=rig(executor,{maxConcurrentSubagents:2});
  try{
    const task=x.scheduler.createTask({title:'局部收敛',instruction:'执行到证据足够即可'});const ticking=x.scheduler.tick();
    for(let i=0;i<100&&!slowStarted;i++)await new Promise(r=>setTimeout(r,2));
    assert.equal(slowStarted,true,'independent sibling starts in parallel');
    for(let i=0;i<100&&!deliveries.some(ids=>ids.includes('fast'));i++)await new Promise(r=>setTimeout(r,2));
    assert.equal(deliveries.some(ids=>ids.includes('fast')),true,'Root receives the early result without waiting for the whole stage');
    assert.equal(x.service.getTask(task.id).status,TaskStatus.RUNNING,'complete candidate cannot silently cancel an issued sibling');
    releaseSlow();await ticking;
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});
