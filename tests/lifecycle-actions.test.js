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
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { TaskStatus, CompletionReason } from '../src/core/types.js';

const complete=(label='done')=>({kind:'complete',summary:label,finalResult:label,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[]});
function rig(executor={async runRoot({onExecutionStarted}={}){onExecutionStarted?.();return complete();},async runSubagent(){throw new Error('unused');}},options={}){
  const dir=mkdtempSync(join(tmpdir(),'taskboard-lifecycle-')),db=new JsonTaskDatabase(join(dir,'db.json')),repo=new JsonTaskRepository(db),service=new TaskService(repo),router=new ModelRouter(),subagent=new SubagentRuntime({executor,modelRouter:router}),root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,maxConcurrentSubagents:2,retryDelaysMs:[0,0,0,0]}),scheduler=new Scheduler({repository:repo,taskService:service,rootRuntime:root,maxConcurrentTasks:options.maxConcurrentTasks||1,intervalMs:999999,retryDelaysMs:[0,0,0,0]});
  return{dir,db,repo,service,root,scheduler,close(){scheduler.stop();db.close();rmSync(dir,{recursive:true,force:true});}};
}

test('Root may surface evaluator-derived goal satisfaction but cannot change Task lifecycle by itself',async()=>{
  const x=rig();try{const task=x.scheduler.createTask({title:'Owner boundary',instruction:'verify lifecycle owner'});assert.equal(x.service.getTask(task.id).status,TaskStatus.READY);const outcome=await x.root.execute(x.repo.getTask(task.id));assert.equal(outcome.kind,'goal_satisfied');assert.equal(x.service.getTask(task.id).status,TaskStatus.READY,'only Scheduler may perform lifecycle transition');}finally{x.close();}
});

test('READY delete is logical, disappears from lists/counts, and cannot execute later',async()=>{const x=rig();try{const task=x.scheduler.createTask({title:'Delete ready',instruction:'never execute'});assert.deepEqual(x.scheduler.deleteTask(task.id),{deleted:true});assert.throws(()=>x.service.getTask(task.id),/TASK_NOT_FOUND/);assert.equal(x.service.counts().READY,0);assert.equal(x.service.listTasks({status:TaskStatus.READY}).length,0);assert.ok(x.repo.getTask(task.id).deleted_at);await x.scheduler.tick();assert.equal(x.service.counts().RUNNING,0);}finally{x.close();}});

test('delete intent is rejected after Scheduler has claimed RUNNING and is never auto-converted to cancel',async()=>{let started=false;const executor={async runRoot({signal,onExecutionStarted}){started=true;onExecutionStarted?.();return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{const error=new Error('interrupted');error.interrupted=true;reject(error);},{once:true}));},async runSubagent(){throw new Error('unused');}};const x=rig(executor);try{const task=x.scheduler.createTask({title:'Race delete',instruction:'run'}),tick=x.scheduler.tick();for(let i=0;i<50&&!started;i+=1)await new Promise(r=>setTimeout(r,5));assert.equal(x.service.getTask(task.id).status,TaskStatus.RUNNING);assert.throws(()=>x.scheduler.deleteTask(task.id),/TASK_DELETE_BECAME_RUNNING/);assert.equal(x.service.getTask(task.id).status,TaskStatus.RUNNING);x.scheduler.requestCancel(task.id);await tick;assert.equal(x.service.getTask(task.id).completion_reason,CompletionReason.CANCELLED);}finally{x.close();}});

test('COMPLETED lock blocks logical delete; unlock allows delete',async()=>{const x=rig();try{const task=x.scheduler.createTask({title:'Keep history',instruction:'finish'});await x.scheduler.tick();assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);assert.equal(x.scheduler.setLocked(task.id,true).locked,true);assert.throws(()=>x.scheduler.deleteTask(task.id),/TASK_LOCKED/);assert.equal(x.scheduler.setLocked(task.id,false).locked,false);assert.deepEqual(x.scheduler.deleteTask(task.id),{deleted:true});assert.throws(()=>x.service.getTask(task.id),/TASK_NOT_FOUND/);}finally{x.close();}});

test('COMPLETED list sorts locked first then by completion phase time; lock does not rewrite lifecycle time',async()=>{const x=rig();let now=new Date('2026-08-08T10:00:00.000Z');x.repo.now=()=>now.toISOString();try{const a=x.scheduler.createTask({title:'A',instruction:'A'});await x.scheduler.tick();now=new Date('2026-08-08T11:00:00.000Z');const b=x.scheduler.createTask({title:'B',instruction:'B'});await x.scheduler.tick();now=new Date('2026-08-08T12:00:00.000Z');const c=x.scheduler.createTask({title:'C',instruction:'C'});await x.scheduler.tick();const aTime=x.service.getTask(a.id).status_entered_at,bTime=x.service.getTask(b.id).status_entered_at;x.scheduler.setLocked(a.id,true);x.scheduler.setLocked(b.id,true);assert.equal(x.service.getTask(a.id).status_entered_at,aTime);assert.equal(x.service.getTask(b.id).status_entered_at,bTime);assert.deepEqual(x.service.listTasks({status:TaskStatus.COMPLETED}).map(t=>t.id),[b.id,a.id,c.id]);}finally{x.close();}});
