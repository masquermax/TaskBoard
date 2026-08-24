import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { ModelRouter } from '../src/core/model-router.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { Scheduler } from '../src/core/scheduler.js';
import { TaskStatus, ReadyReason } from '../src/core/types.js';

function complete(result='done'){return{kind:'complete',summary:'done',finalResult:result,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};}
function work(id){return{id,title:id,goal:`execute ${id}`,expectedOutput:`${id} result`,stopCondition:`${id} result returned`,projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};}
function rig(executor,{taskConcurrency=2,taskMaxSubagents=3,retryDelaysMs=[1,1,1,1]}={}){
  const dir=mkdtempSync(join(tmpdir(),'taskboard-runtime-regression-')),db=new JsonTaskDatabase(join(dir,'db.json')),repo=new JsonTaskRepository(db),service=new TaskService(repo),router=new ModelRouter(),subagent=new SubagentRuntime({executor,modelRouter:router}),root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,maxConcurrentSubagents:taskMaxSubagents,retryDelaysMs}),scheduler=new Scheduler({repository:repo,taskService:service,rootRuntime:root,maxConcurrentTasks:taskConcurrency,retryDelaysMs,intervalMs:999999});
  return{dir,db,repo,service,root,scheduler,close(){scheduler.stop();db.close();rmSync(dir,{recursive:true,force:true});}};
}
async function waitUntil(predicate,{tries=120,delay=2}={}){for(let i=0;i<tries;i++){if(predicate())return true;await new Promise(r=>setTimeout(r,delay));}return false;}

test('Task stays READY until a real Root execution reports admission',async()=>{
  let signalStart,resolveRoot,entered=false;
  const executor={async runRoot({onExecutionStarted}){entered=true;signalStart=onExecutionStarted;return new Promise(resolve=>{resolveRoot=()=>resolve(complete());});},async runSubagent(){throw new Error('unused');}};
  const x=rig(executor,{taskConcurrency:1});
  try{
    const task=x.scheduler.createTask({title:'admission',instruction:'run'}),tick=x.scheduler.tick();
    assert.equal(await waitUntil(()=>entered),true);assert.equal(x.service.getTask(task.id).status,TaskStatus.READY);
    signalStart();assert.equal(await waitUntil(()=>x.service.getTask(task.id).status===TaskStatus.RUNNING),true);
    resolveRoot();await tick;assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});

test('Root capacity shortage remains READY and consumes no failure attempt',async()=>{
  const executor={async runRoot(){const error=new Error('no available agent capacity');error.capacityUnavailable=true;throw error;},async runSubagent(){throw new Error('unused');}};
  const x=rig(executor,{taskConcurrency:1});
  try{
    const task=x.scheduler.createTask({title:'no root',instruction:'run'}),enteredAt=task.status_entered_at;await x.scheduler.tick();const current=x.service.getTask(task.id);
    assert.equal(current.status,TaskStatus.READY);assert.equal(current.ready_reason,ReadyReason.WAITING_RESOURCE);assert.equal(current.executionState.retry.scope,'root-capacity');assert.equal(current.executionState.retry.failureCount,0);assert.equal(current.status_entered_at,enteredAt);
  }finally{x.close();}
});

test('Subagent capacity shortage stays on the Work Unit and returns Task to READY',async()=>{
  let rootCalls=0;
  const executor={
    async runRoot({onExecutionStarted}){rootCalls+=1;onExecutionStarted?.();return{kind:'delegate',summary:'delegate',finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[work('W-1')]};},
    async runSubagent(){const error=new Error('server overloaded; retry later');error.capacityUnavailable=true;throw error;},
  };
  const x=rig(executor,{taskConcurrency:1});
  try{
    const task=x.scheduler.createTask({title:'Subagent capacity',instruction:'run'});await x.scheduler.tick();const current=x.service.getTask(task.id),unit=x.root.snapshot(task.id).stage.workUnits[0];
    assert.equal(rootCalls,1);assert.equal(current.status,TaskStatus.READY);assert.equal(current.ready_reason,ReadyReason.WAITING_RESOURCE);assert.equal(unit.status,'WAITING_RESOURCE');assert.equal(unit.failureCount,0);
  }finally{x.close();}
});

test('lowering Task concurrency does not preempt admitted Tasks',async()=>{
  const releases=[];let starts=0;
  const executor={async runRoot({onExecutionStarted}){starts+=1;onExecutionStarted?.();return new Promise(resolve=>releases.push(()=>resolve(complete())));},async runSubagent(){throw new Error('unused');}};
  const x=rig(executor,{taskConcurrency:3});
  try{
    for(let i=0;i<4;i++)x.scheduler.createTask({title:`T${i}`,instruction:'run'});
    const first=x.scheduler.tick();assert.equal(await waitUntil(()=>starts===3),true);assert.equal(x.service.counts().RUNNING,3);assert.equal(x.service.counts().READY,1);
    x.scheduler.setConcurrency(1);releases.shift()();await waitUntil(()=>x.service.counts().RUNNING===2);await x.scheduler.tick();assert.equal(starts,3);
    releases.shift()();releases.shift()();await first;const second=x.scheduler.tick();assert.equal(await waitUntil(()=>starts===4),true);releases.shift()();await second;assert.equal(x.service.counts().COMPLETED,4);
  }finally{x.close();}
});

test('per-Task Subagent ceiling is local to each Root rather than a global pool',async()=>{
  const releases=[];const activeByTask=new Map();let totalActive=0,maxTotal=0;
  const executor={
    async runRoot({task,subagentResults,onExecutionStarted}){onExecutionStarted?.();if(!subagentResults.length)return{kind:'delegate',summary:'split',finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[1,2,3].map(n=>work(`${task.id}-${n}`))};return complete();},
    async runSubagent({task,delegation,onExecutionStarted}){onExecutionStarted?.();totalActive+=1;maxTotal=Math.max(maxTotal,totalActive);activeByTask.set(task.id,(activeByTask.get(task.id)||0)+1);return new Promise(resolve=>releases.push(()=>{totalActive-=1;activeByTask.set(task.id,activeByTask.get(task.id)-1);resolve({delegationId:delegation.id,result:'done',evidence:[],blocker:null});}));},
  };
  const x=rig(executor,{taskConcurrency:2,taskMaxSubagents:3});
  try{
    x.scheduler.createTask({title:'A',instruction:'run'});x.scheduler.createTask({title:'B',instruction:'run'});const tick=x.scheduler.tick();assert.equal(await waitUntil(()=>maxTotal===6),true);assert.deepEqual([...activeByTask.values()].sort(),[3,3]);releases.splice(0).forEach(fn=>fn());await tick;assert.equal(x.service.counts().COMPLETED,2);
  }finally{x.close();}
});

test('Executor terminal outcome without a reported start cannot allocate or complete a Task',async()=>{
  const executor={async runRoot(){return complete('must not publish');},async runSubagent(){throw new Error('unused');}};
  const x=rig(executor,{taskConcurrency:1}),originalError=console.error;console.error=()=>{};
  try{
    const task=x.scheduler.createTask({title:'executor contract',instruction:'run'});await x.scheduler.tick();const current=x.service.getTask(task.id);
    assert.equal(current.status,TaskStatus.READY);assert.equal(current.ready_reason,ReadyReason.SUSPENDED);assert.equal(current.final_result,null);assert.match(String(current.executionState?.retry?.error||''),/EXECUTOR_START_NOT_REPORTED/);
  }finally{console.error=originalError;x.close();}
});
