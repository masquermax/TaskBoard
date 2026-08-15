import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { Scheduler } from '../src/core/scheduler.js';
import { TaskStatus, ReadyReason, CompletionReason, WorkUnitStatus } from '../src/core/types.js';
import { addUnresolvedEffectAttempt, hasUnresolvedEffectRecovery } from '../src/core/effect-recovery.js';

function rig(execute){
  const dir=mkdtempSync(join(tmpdir(),'taskboard-effect-scheduler-'));
  const dbFile=join(dir,'taskboard.json');
  const database=new JsonTaskDatabase(dbFile);
  const repository=new JsonTaskRepository(database);
  const rootRuntime={
    execute,
    isQuiescent(){return true;},
    snapshot(){return null;},
    retryWorkUnit(){return false;},
    discardSession(){},
    cleanupTaskWorkspace(){return true;},
    requestQuiesce(){return true;},
    interruptForShutdown(){return true;},
    executor:{readiness(){return{ready:true};}},
  };
  const taskService={createTask:payload=>repository.createTask(payload)};
  const scheduler=new Scheduler({repository,taskService,rootRuntime,intervalMs:999999,retryDelaysMs:[1,1,1,1]});
  return{dir,dbFile,database,repository,scheduler,rootRuntime,close(){scheduler.stop();database.close();rmSync(dir,{recursive:true,force:true});}};
}

function createTask(repository,title='effect'){return repository.createTask({title,instruction:'perform bounded work'});}
function attempt(taskId='T-0001'){return{id:`effect:${taskId}:W-1:1`,workUnitId:'W-1',signature:'sig',projectAccess:'write',networkAccess:false,inputRefs:['project:0'],admittedAt:new Date().toISOString(),reason:'effect-capable-work-admitted',resolved:false};}
function suspendedSnapshot(taskId){return{taskId,actor:null,stage:{id:'S-1',title:'stage',startedAt:new Date().toISOString(),workUnits:[{id:'W-1',status:WorkUnitStatus.SUSPENDED,projectAccess:'write',networkAccess:false,failureCount:1,effectRecoveryRequired:true}]},updatedAt:new Date().toISOString()};}

test('D-023: Scheduler persists an unresolved effect attempt and does not erase it when work suspends',async()=>{
  const x=rig(async(task,callbacks)=>{
    const value=attempt(task.id);
    callbacks.onEffectAttempt(value);
    callbacks.onExecutionStarted({role:'subagent'});
    return{kind:'suspended',reason:'unknown effect',snapshot:suspendedSnapshot(task.id)};
  });
  try{
    const task=createTask(x.repository);
    await x.scheduler.tick();
    const saved=x.repository.getTask(task.id);
    assert.equal(saved.status,TaskStatus.READY);
    assert.equal(saved.ready_reason,ReadyReason.SUSPENDED);
    assert.equal(hasUnresolvedEffectRecovery(saved.executionState),true);
    assert.throws(()=>x.scheduler.retryTask(task.id),/EFFECT_RECOVERY_REQUIRED/);
  }finally{x.close();}
});

test('D-023: restart converts ambiguous stale RUNNING into durable suspended recovery instead of fresh actuation',()=>{
  const x=rig(async()=>{throw new Error('must not execute');});
  try{
    const task=createTask(x.repository,'restart');
    x.repository.transitionTask(task.id,TaskStatus.RUNNING,{executionState:null});
    assert.equal(x.scheduler.recoverStaleRunningTasks(),1);
    const recovered=x.repository.getTask(task.id);
    assert.equal(recovered.status,TaskStatus.READY);
    assert.equal(recovered.ready_reason,ReadyReason.SUSPENDED);
    assert.equal(hasUnresolvedEffectRecovery(recovered.executionState),true);
  }finally{x.close();}
});

test('D-023: a durable WorkReceipt clears only its matching effect attempt',async()=>{
  const x=rig(async(task,callbacks)=>{
    const value=attempt(task.id);
    callbacks.onEffectAttempt(value);
    callbacks.onExecutionStarted({role:'subagent'});
    callbacks.onWorkReceipt({
      id:'W-1',signature:'sig',effectAttemptId:value.id,
      workUnit:{id:'W-1',title:'write',goal:'change',expectedOutput:'done',stopCondition:'done',projectAccess:'write',networkAccess:false,inputRefs:[],dependsOn:[],skillId:null},
      result:{delegationId:'W-1',result:'done',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null},
      completed_at:new Date().toISOString(),
    });
    return{kind:'goal_satisfied',proposal:{finalResult:'done',stageResult:null,summary:'done'}};
  });
  try{
    const task=createTask(x.repository,'receipt');
    await x.scheduler.tick();
    const saved=x.repository.getTask(task.id);
    assert.equal(saved.status,TaskStatus.COMPLETED);
    assert.equal(saved.completion_reason,CompletionReason.SUCCESS);
    assert.equal(saved.workReceipts.length,1);
    assert.equal(hasUnresolvedEffectRecovery(saved.executionState),false);
  }finally{x.close();}
});

test('D-023: cancellation ends lifecycle but preserves unresolved reality truth',()=>{
  const x=rig(async()=>{throw new Error('unused');});
  try{
    const task=createTask(x.repository,'cancel');
    const state=addUnresolvedEffectAttempt(null,attempt(task.id));
    x.repository.transitionTask(task.id,TaskStatus.RUNNING,{executionState:state});
    const result=x.scheduler.requestCancel(task.id);
    assert.equal(result.pending,false);
    const saved=x.repository.getTask(task.id);
    assert.equal(saved.status,TaskStatus.COMPLETED);
    assert.equal(saved.completion_reason,CompletionReason.CANCELLED);
    assert.equal(hasUnresolvedEffectRecovery(saved.executionState),true);
  }finally{x.close();}
});

test('D-023: unresolved recovery is local and does not freeze an independent Task',async()=>{
  let executions=0;
  const x=rig(async(task,callbacks)=>{executions+=1;callbacks.onExecutionStarted({role:'root'});return{kind:'goal_satisfied',proposal:{finalResult:task.title,stageResult:null,summary:'done'}};});
  try{
    const blocked=createTask(x.repository,'X');
    const blockedState=addUnresolvedEffectAttempt(null,attempt(blocked.id));
    x.repository.touchTask(blocked.id,{readyReason:ReadyReason.SUSPENDED,executionState:blockedState});
    const independent=createTask(x.repository,'Y');
    await x.scheduler.tick();
    assert.equal(executions,1);
    assert.equal(x.repository.getTask(blocked.id).status,TaskStatus.READY);
    assert.equal(x.repository.getTask(independent.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});
