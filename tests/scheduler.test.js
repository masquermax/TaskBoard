import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { ModelRouter } from '../src/core/model-router.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { Scheduler } from '../src/core/scheduler.js';
import { MockExecutor } from '../src/extensions/executors/mock/mock-executor.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { asRuntimeExecutor } from './helpers/runtime-executor.js';
import { TaskStatus, ReadyReason, CompletionReason, WorkUnitStatus } from '../src/core/types.js';

function executionComplete(result='done') {
  return {
    kind:'complete', summary:'done', finalResult:result, resultMode:'execution',
    evidence:[], claims:[], gaps:[], recommendations:[], steps:[], gapResolutions:[],
    gateway:null, delegations:[],
  };
}

function delegate(workUnits) {
  return {
    kind:'delegate', summary:'delegate', finalResult:null, resultMode:'execution',
    evidence:[], claims:[], gaps:[], recommendations:[], steps:[], gapResolutions:[],
    gateway:null, delegations:workUnits,
  };
}

function work(id,title=id,overrides={}) {
  return {
    id, title, goal:title, expectedOutput:`${title} result`, stopCondition:`${title} done`,
    projectAccess:'none', networkAccess:false, skillId:null, dependsOn:[], inputRefs:[],
    ...overrides,
  };
}

function humanGatewayExecutor(){
  const gap={id:'G-HUMAN',question:'请选择本次范围',reason:'该范围由用户拥有',kind:'business_decision',blocking:true,evidenceIds:[]};
  return{
    async runRoot({humanGatewayHistory=[],onExecutionStarted}){
      onExecutionStarted?.();
      const resolved=humanGatewayHistory.find(item=>item?.status==='RESOLVED');
      if(!resolved)return{kind:'human_gateway',summary:'等待用户范围',finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[gap],recommendations:[],steps:[],gapResolutions:[],gateway:{gapId:gap.id,question:gap.question,context:gap.reason,options:['基础办公']},delegations:[]};
      const evidenceId=`E-HUMAN-${resolved.id}`;
      return{kind:'complete',summary:'用户范围已确认',finalResult:'done',resultMode:'execution',evidence:[{id:evidenceId,strength:'direct',kind:'requirement',sourceType:'human',coverage:'source',statement:resolved.answer,basis:`Human Gateway ${resolved.id}`,locator:`human:${resolved.id}`,observation:resolved.answer}],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[{gapId:gap.id,reason:'用户已明确该范围',evidenceIds:[evidenceId]}],gateway:null,delegations:[]};
    },
    async runSubagent(){throw new Error('unused');},
  };
}

function rig(executor=new MockExecutor(),{maxConcurrentSubagents=3,retryDelaysMs=[0,0,0,0]}={}) {
  const dir=mkdtempSync(join(tmpdir(),'taskboard-scheduler-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));
  const repo=new JsonTaskRepository(db);
  const service=new TaskService(repo);
  const router=new ModelRouter();
  const runtimeExecutor=asRuntimeExecutor(executor);
  const subagentRuntime=new SubagentRuntime({executor:runtimeExecutor,modelRouter:router});
  const rootRuntime=new RootRuntime({
    ...successfulCompletionDependenciesForControlFlowTest(),
    executor:runtimeExecutor, modelRouter:router, subagentRuntime, maxConcurrentSubagents, retryDelaysMs,
  });
  const scheduler=new Scheduler({repository:repo,taskService:service,rootRuntime,intervalMs:999999,retryDelaysMs});
  return {dir,db,repo,service,rootRuntime,scheduler,close(){scheduler.stop();db.close();rmSync(dir,{recursive:true,force:true});}};
}

async function waitUntil(predicate,{tries=120,delay=3}={}) {
  for(let i=0;i<tries;i+=1){ if(predicate())return true; await new Promise(resolve=>setTimeout(resolve,delay)); }
  return false;
}

test('Scheduler owns Human Gateway lifecycle and resumes only after the answer',async()=>{
  const x=rig(humanGatewayExecutor());
  try{
    const task=x.scheduler.createTask({title:'需要用户范围',instruction:'执行'});
    await x.scheduler.tick();
    assert.equal(x.service.getTask(task.id).status,TaskStatus.WAITING_HUMAN);
    x.scheduler.answerHumanGateway(task.id,'基础办公');
    assert.equal(x.service.getTask(task.id).status,TaskStatus.READY);
    await x.scheduler.tick();
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});

test('Scheduler keeps a Task READY until the Executor is actually ready',async()=>{
  let ready=false,calls=0;
  const executor={
    readiness(){return ready?{ready:true,preparing:false}:{ready:false,preparing:true,message:'执行组件正在后台准备，无需操作。'};},
    async runRoot({onExecutionStarted}){calls+=1;onExecutionStarted?.();return executionComplete('runtime ready');},
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'运行时准备',instruction:'等待执行器'});
    await x.scheduler.tick();
    assert.equal(calls,0);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.READY);
    assert.equal(x.scheduler.getTaskActivity(task.id).summary,'等待执行资源');
    ready=true;
    await x.scheduler.tick();
    assert.equal(calls,1);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});

test('Root retry is represented as Root actor state, never as a synthetic Work Unit',async()=>{
  let calls=0;
  const executor={
    async runRoot(){calls+=1;throw new Error('stream disconnected before completion: error sending request for url');},
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor,{retryDelaysMs:[5_000,5_000,5_000,5_000]});
  try{
    const task=x.scheduler.createTask({title:'Root retry',instruction:'run'});
    await x.scheduler.tick();
    const current=x.repo.getTask(task.id);
    assert.equal(calls,1);
    assert.equal(current.status,TaskStatus.READY);
    assert.equal(current.ready_reason,ReadyReason.RETRY_WAIT);
    assert.equal(current.executionState.snapshot.stage,null);
    assert.equal(current.executionState.snapshot.actor.owner,'root');
    assert.equal(current.executionState.snapshot.actor.status,WorkUnitStatus.RETRY_WAIT);
    assert.equal(current.executionState.snapshot.completedWorkUnits.length,0);
    x.scheduler.activities.delete(task.id);
    assert.equal(x.scheduler.getTaskActivity(task.id).summary,'等待自动重试');
  }finally{x.close();}
});

test('retryable Root failures are hard-capped at five attempts without creating a sixth',async()=>{
  let calls=0;
  const executor={async runRoot(){calls+=1;throw new Error('temporary network connection failure');},async runSubagent(){throw new Error('unused');}};
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'重试上限',instruction:'测试'});
    for(let i=0;i<8;i+=1)await x.scheduler.tick();
    const current=x.repo.getTask(task.id);
    assert.equal(calls,5);
    assert.equal(current.status,TaskStatus.READY);
    assert.equal(current.ready_reason,ReadyReason.SUSPENDED);
    assert.equal(current.executionState.retry.failureCount,5);
    assert.equal(current.executionState.snapshot.stage,null);
    assert.equal(current.executionState.snapshot.actor.status,WorkUnitStatus.SUSPENDED);
    await x.scheduler.tick();
    assert.equal(calls,5);
  }finally{x.close();}
});

test('invalid Root planning fails once at the contract boundary and never enters a planning-repair loop',async()=>{
  let rootCalls=0,subagentCalls=0;
  const duplicate=work('a','same');
  const executor={
    async runRoot({onExecutionStarted}){rootCalls+=1;onExecutionStarted?.();return delegate([duplicate,{...duplicate,id:'b'}]);},
    async runSubagent(){subagentCalls+=1;},
  };
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'invalid plan',instruction:'run'});
    await x.scheduler.tick();
    const current=x.repo.getTask(task.id);
    assert.equal(rootCalls,1);
    assert.equal(subagentCalls,0);
    assert.equal(current.status,TaskStatus.READY);
    assert.equal(current.ready_reason,ReadyReason.SUSPENDED);
    assert.equal(current.pendingGateway,null);
    assert.equal(current.executionState.retry.failureCount,1);
    assert.equal(current.executionState.snapshot.actor.owner,'root');
    assert.equal(current.executionState.snapshot.actor.status,WorkUnitStatus.SUSPENDED);
  }finally{x.close();}
});

test('manual Root retry starts a new Root attempt instead of retrying a fake Work Unit',async()=>{
  let rootCalls=0;
  const duplicate=work('a','same');
  const executor={
    async runRoot({onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      return rootCalls===1?delegate([duplicate,{...duplicate,id:'b'}]):executionComplete('recovered');
    },
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'retry root',instruction:'run'});
    await x.scheduler.tick();
    const suspended=x.repo.getTask(task.id);
    assert.equal(suspended.ready_reason,ReadyReason.SUSPENDED);
    assert.equal(suspended.executionState.snapshot.stage,null);
    const reset=x.scheduler.retryTask(task.id,'root');
    assert.equal(reset.ready_reason,ReadyReason.WAITING_RESOURCE);
    assert.equal(reset.executionState.retry.scope,'root');
    assert.equal(reset.executionState.retry.failureCount,0);
    assert.equal(await waitUntil(()=>x.service.getTask(task.id).status===TaskStatus.COMPLETED),true);
    assert.equal(rootCalls,2);
  }finally{x.close();}
});

test('Stage projection contains only Subagent Work Units and preserves completed siblings',async()=>{
  let secondRelease=null,rootCalls=0;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      if(!subagentResults.length)return delegate([work('a','A'),work('b','B'),work('c','C')]);
      return executionComplete('done');
    },
    async runSubagent({delegation,onExecutionStarted}){
      onExecutionStarted?.();
      if(delegation.id==='a')return{delegationId:'a',result:'A done',evidence:[],blocker:null};
      if(delegation.id==='b')return new Promise(resolve=>{secondRelease=()=>resolve({delegationId:'b',result:'B done',evidence:[],blocker:null});});
      return{delegationId:'c',result:'C done',evidence:[],blocker:null};
    },
  };
  const x=rig(executor,{maxConcurrentSubagents:1});
  try{
    const task=x.scheduler.createTask({title:'stage',instruction:'run'});
    const tick=x.scheduler.tick();
    assert.equal(await waitUntil(()=>{
      const units=x.scheduler.getTaskActivity(task.id)?.current?.stage?.workUnits||[];
      return units.some(unit=>unit.id==='a'&&unit.status===WorkUnitStatus.COMPLETED)&&units.some(unit=>unit.id==='b'&&unit.status===WorkUnitStatus.RUNNING);
    }),true);
    const snapshot=x.scheduler.getTaskActivity(task.id).current;
    assert.equal(snapshot.actor,null,'Root is not running while a Stage is executing');
    assert.deepEqual(snapshot.stage.workUnits.map(unit=>unit.owner),['subagent','subagent',null]);
    assert.equal(snapshot.stage.workUnits.find(unit=>unit.id==='c').status,WorkUnitStatus.WAITING_RESOURCE);
    assert.equal(x.service.progressHistory(task.id).length,0);
    secondRelease();
    await tick;
    assert.equal(rootCalls,2,'Root wakes once after the whole Stage completes');
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});

test('dependency wait is a Work Unit state and does not create another runtime owner',async()=>{
  let release=null;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){onExecutionStarted?.();return subagentResults.length?executionComplete():delegate([work('a','A'),work('b','B',{dependsOn:['a']})]);},
    async runSubagent({delegation,onExecutionStarted}){onExecutionStarted?.();if(delegation.id==='a')return new Promise(resolve=>{release=()=>resolve({delegationId:'a',result:'A done',evidence:[],blocker:null});});return{delegationId:'b',result:'B done',evidence:[],blocker:null};},
  };
  const x=rig(executor,{maxConcurrentSubagents:2});
  try{
    const task=x.scheduler.createTask({title:'deps',instruction:'run'});
    const tick=x.scheduler.tick();
    assert.equal(await waitUntil(()=>Boolean(release)),true);
    const units=x.scheduler.getTaskActivity(task.id).current.stage.workUnits;
    assert.equal(units.find(unit=>unit.id==='a').status,WorkUnitStatus.RUNNING);
    assert.equal(units.find(unit=>unit.id==='b').status,WorkUnitStatus.WAITING_DEPENDENCY);
    assert.equal(units.find(unit=>unit.id==='b').owner,null);
    release();
    await tick;
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});

test('manual retry changes the suspended Work Unit only and continues the existing Stage',async()=>{
  let rootCalls=0,subagentCalls=0;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){rootCalls+=1;onExecutionStarted?.();return subagentResults.length?executionComplete('done'):delegate([work('w','bounded work')]);},
    async runSubagent({delegation,onExecutionStarted}){
      subagentCalls+=1;onExecutionStarted?.();
      if(subagentCalls===1){const error=new Error('deterministic local failure');error.nonRetryable=true;throw error;}
      return{delegationId:delegation.id,result:'recovered',evidence:[],blocker:null};
    },
  };
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'work retry',instruction:'run'});
    await x.scheduler.tick();
    const suspended=x.repo.getTask(task.id);
    assert.equal(suspended.status,TaskStatus.READY);
    assert.equal(suspended.ready_reason,ReadyReason.SUSPENDED);
    const before=x.rootRuntime.snapshot(task.id).stage.workUnits[0];
    assert.equal(before.id,'w');
    assert.equal(before.status,WorkUnitStatus.SUSPENDED);
    const taskReadyEnteredAt=suspended.status_entered_at;

    const ready=x.scheduler.retryTask(task.id,'w');
    const reset=ready.executionState.snapshot.stage.workUnits[0];
    assert.equal(reset.status,WorkUnitStatus.WAITING_RESOURCE);
    assert.equal(reset.failureCount,0);
    assert.equal(ready.status_entered_at,taskReadyEnteredAt,'retrying the Work Unit must not rewrite Task READY entry time');

    assert.equal(await waitUntil(()=>x.service.getTask(task.id).status===TaskStatus.COMPLETED),true);
    assert.equal(subagentCalls,2);
    assert.equal(rootCalls,2,'the original Root plan is not replayed; Root resumes only after the retried Stage completes');
  }finally{x.close();}
});

test('cancel of a running Root is an intent; Scheduler completes lifecycle only after Root quiesces',async()=>{
  let started=false;
  const executor={
    async runRoot({signal,onExecutionStarted}){started=true;onExecutionStarted?.();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{const error=new Error('interrupted');error.interrupted=true;reject(error);},{once:true}));},
    async runSubagent(){throw new Error('unused');},
  };
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'cancel root',instruction:'run'});
    const tick=x.scheduler.tick();
    assert.equal(await waitUntil(()=>started),true);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.RUNNING);
    assert.equal(x.scheduler.requestCancel(task.id).pending,true);
    await tick;
    const done=x.service.getTask(task.id);
    assert.equal(done.status,TaskStatus.COMPLETED);
    assert.equal(done.completion_reason,CompletionReason.CANCELLED);
    assert.equal(done.cancel_requested_at,null);
  }finally{x.close();}
});

test('cancel waits for an active Subagent promise to settle before completing the Task',async()=>{
  let workerStarted=false,workerSettled=false;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){onExecutionStarted?.();return subagentResults.length?executionComplete():delegate([work('slow','slow')]);},
    async runSubagent({signal,onExecutionStarted}){
      workerStarted=true;onExecutionStarted?.();
      return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>setTimeout(()=>{workerSettled=true;const error=new Error('interrupted');error.interrupted=true;reject(error);},30),{once:true}));
    },
  };
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'cancel work',instruction:'run'});
    const tick=x.scheduler.tick();
    assert.equal(await waitUntil(()=>workerStarted),true);
    assert.equal(x.scheduler.requestCancel(task.id).pending,true);
    await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(workerSettled,false);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.RUNNING);
    await tick;
    assert.equal(workerSettled,true);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
    assert.equal(x.service.getTask(task.id).completion_reason,CompletionReason.CANCELLED);
  }finally{x.close();}
});

test('WAITING_HUMAN is quiescent and Scheduler may cancel it directly',async()=>{
  const x=rig(humanGatewayExecutor());
  try{
    const task=x.scheduler.createTask({title:'等待用户范围',instruction:'执行'});
    await x.scheduler.tick();
    assert.equal(x.service.getTask(task.id).status,TaskStatus.WAITING_HUMAN);
    const result=x.scheduler.requestCancel(task.id);
    assert.equal(result.pending,false);
    assert.equal(result.task.status,TaskStatus.COMPLETED);
    assert.equal(result.task.completion_reason,CompletionReason.CANCELLED);
  }finally{x.close();}
});
