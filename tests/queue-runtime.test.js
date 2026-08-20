import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { Scheduler } from '../src/core/scheduler.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { asRuntimeExecutor } from './helpers/runtime-executor.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { MockExecutor } from '../src/extensions/executors/mock/mock-executor.js';
import { TaskStatus, ReadyReason } from '../src/core/types.js';

function setupScheduler(executor=new MockExecutor(),options={}){
  const dir=mkdtempSync(join(tmpdir(),'taskboard-queue-')),db=new JsonTaskDatabase(join(dir,'db.json')),repo=new JsonTaskRepository(db),service=new TaskService(repo),router=new ModelRouter(),runtimeExecutor=asRuntimeExecutor(executor),subagentRuntime=new SubagentRuntime({executor:runtimeExecutor,modelRouter:router}),rootRuntime=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor:runtimeExecutor,modelRouter:router,subagentRuntime,retryDelaysMs:options.retryDelaysMs||[0,0,0,0],maxConcurrentSubagents:options.maxConcurrentSubagents||4}),scheduler=new Scheduler({repository:repo,taskService:service,rootRuntime,intervalMs:999999,maxConcurrentTasks:options.maxConcurrentTasks||2,retryDelaysMs:options.retryDelaysMs||[0,0,0,0]});return{dir,db,repo,service,scheduler,rootRuntime,close(){scheduler.stop();db.close();rmSync(dir,{recursive:true,force:true});}};
}
const complete=finalResult=>({kind:'complete',summary:'done',finalResult:finalResult||'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[]});
function humanGatewayExecutor(){const gap={id:'G-Q',question:'请选择范围',reason:'范围由用户拥有',kind:'business_decision',blocking:true,evidenceIds:[]};return{async runRoot({onExecutionStarted}){onExecutionStarted?.();return{kind:'human_gateway',summary:'需要用户范围',finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[gap],recommendations:[],steps:[],gapResolutions:[],gateway:{gapId:gap.id,question:gap.question,context:gap.reason,options:['基础办公']},delegations:[]};},async runSubagent(){throw new Error('unused');}};}

test('new Task enters READY/NEW; Human Gateway reply returns READY/HUMAN_REPLY',async()=>{const x=setupScheduler(humanGatewayExecutor());try{const task=x.scheduler.createTask({title:'需要用户范围',instruction:'执行'});assert.equal(task.status,TaskStatus.READY);assert.equal(task.ready_reason,ReadyReason.NEW);await x.scheduler.tick();assert.equal(x.service.getTask(task.id).status,TaskStatus.WAITING_HUMAN);const replied=x.scheduler.answerHumanGateway(task.id,'基础办公');assert.equal(replied.status,TaskStatus.READY);assert.equal(replied.ready_reason,ReadyReason.HUMAN_REPLY);}finally{x.close();}});

test('status lists sort latest activity descending while Scheduler claims oldest READY first',()=>{let now=new Date('2026-08-07T12:00:00.000Z');const dir=mkdtempSync(join(tmpdir(),'taskboard-order-')),db=new JsonTaskDatabase(join(dir,'db.json')),repo=new JsonTaskRepository(db);repo.now=()=>now.toISOString();const service=new TaskService(repo);try{const a=service.createTask({title:'A',instruction:'A'});now=new Date('2026-08-07T12:01:00.000Z');const b=service.createTask({title:'B',instruction:'B'});assert.deepEqual(service.listTasks({status:TaskStatus.READY}).map(t=>t.id),[b.id,a.id]);assert.deepEqual(repo.listRunnableTasks(10).map(t=>t.id),[a.id,b.id]);}finally{db.close();rmSync(dir,{recursive:true,force:true});}});

test('RUNNING means a Task execution slot is actually occupied and never exceeds configured concurrency',async()=>{const releases=[];let started=0;const executor={async runRoot({onExecutionStarted}){started+=1;onExecutionStarted?.();return new Promise(resolve=>releases.push(()=>resolve(complete())));},async runSubagent(){throw new Error('unused');}};const x=setupScheduler(executor,{maxConcurrentTasks:2});try{for(let i=0;i<5;i+=1)x.scheduler.createTask({title:`T${i}`,instruction:'work'});const tick=x.scheduler.tick();for(let i=0;i<50&&started<2;i+=1)await new Promise(r=>setTimeout(r,5));assert.equal(started,2);assert.equal(x.service.counts().RUNNING,2);assert.equal(x.service.counts().READY,3);releases.splice(0).forEach(fn=>fn());await tick;assert.equal(x.service.counts().COMPLETED,2);}finally{x.close();}});

test('non-retryable executor protocol error suspends after the first Root attempt and never loops',async()=>{let calls=0;const executor={async runRoot(){calls+=1;const error=new Error('Invalid request: unknown variant workspaceWrite');error.nonRetryable=true;throw error;},async runSubagent(){throw new Error('unused');}};const x=setupScheduler(executor);try{const task=x.scheduler.createTask({title:'协议错误',instruction:'不要反复消耗'});await x.scheduler.tick();const current=x.service.getTask(task.id);assert.equal(calls,1);assert.equal(current.status,TaskStatus.READY);assert.equal(current.ready_reason,ReadyReason.SUSPENDED);assert.equal(current.executionState.retry.failureCount,1);assert.equal(current.executionState.snapshot.stage,null);assert.equal(current.executionState.snapshot.actor.owner,'root');await x.scheduler.tick();assert.equal(calls,1);}finally{x.close();}});

test('startup recovery is Scheduler-owned and reconciles stale RUNNING back to READY',()=>{const x=setupScheduler();try{const task=x.scheduler.createTask({title:'中断任务',instruction:'恢复'});x.repo.transitionTask(task.id,TaskStatus.RUNNING);assert.equal(x.scheduler.recoverStaleRunningTasks(),1);assert.equal(x.service.getTask(task.id).status,TaskStatus.READY);}finally{x.close();}});
