import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { Scheduler } from '../src/core/scheduler.js';
import { TaskStatus, ReadyReason, CompletionReason, WorkUnitStatus } from '../src/core/types.js';
import { addUnresolvedEffectAttempt, hasCompetingEffectActuation, hasUnresolvedEffectRecovery, markEffectActuationClosed, unresolvedEffectAttempts } from '../src/core/effect-recovery.js';

function rig(execute){
  const dir=mkdtempSync(join(tmpdir(),'taskboard-effect-scheduler-'));
  const dbFile=join(dir,'taskboard.json');
  const database=new JsonTaskDatabase(dbFile);
  const repository=new JsonTaskRepository(database);
  let discardCount=0;
  const rootRuntime={
    execute,
    isQuiescent(){return true;},
    snapshot(){return null;},
    retryWorkUnit(){return false;},
    discardSession(){discardCount+=1;},
    cleanupTaskWorkspace(){return true;},
    requestQuiesce(){return true;},
    interruptForShutdown(){return true;},
    executor:{readiness(){return{ready:true};}},
  };
  const taskService={createTask:payload=>repository.createTask(payload)};
  const scheduler=new Scheduler({repository,taskService,rootRuntime,intervalMs:999999,retryDelaysMs:[1,1,1,1]});
  return{dir,dbFile,database,repository,scheduler,rootRuntime,discardCount:()=>discardCount,close(){scheduler.stop();database.close();rmSync(dir,{recursive:true,force:true});}};
}

function createTask(repository,title='effect'){return repository.createTask({title,instruction:'perform bounded work'});}
function attempt(taskId='T-0001'){return{id:`effect:${taskId}:W-1:1`,workUnitId:'W-1',signature:'sig',projectAccess:'write',networkAccess:false,inputRefs:['project:0'],admittedAt:new Date().toISOString(),reason:'effect-capable-work-admitted',resolved:false};}
function suspendedSnapshot(taskId){return{taskId,actor:null,stage:{id:'S-1',title:'stage',startedAt:new Date().toISOString(),workUnits:[{id:'W-1',status:WorkUnitStatus.SUSPENDED,projectAccess:'write',networkAccess:false,failureCount:1,effectRecoveryRequired:true}]},updatedAt:new Date().toISOString()};}
function readOnlyWork(id='W-CLOSURE'){return{id,title:'observe closure',goal:'observe',expectedOutput:'closure evidence',stopCondition:'stop after evidence',projectAccess:'read',networkAccess:false,inputRefs:['project:0'],dependsOn:[],skillId:null};}
function writeWork(id='W-2'){return{id,title:'fresh write',goal:'change',expectedOutput:'done',stopCondition:'done',projectAccess:'write',networkAccess:false,inputRefs:['project:0'],dependsOn:[],skillId:null};}

test('D-023: first unknown effect schedules one bounded recovery observation instead of blind replay',async()=>{
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
    assert.equal(saved.ready_reason,ReadyReason.WAITING_RESOURCE);
    assert.equal(saved.executionState?.retry?.scope,'effect-recovery-observe');
    assert.equal(saved.executionState?.retry?.paused,false);
    assert.equal(hasUnresolvedEffectRecovery(saved.executionState),true);
    assert.equal(hasCompetingEffectActuation(saved.executionState),true);
    assert.equal(x.discardCount(),1,'the stale transient Work plan must not be resumed during recovery');
    assert.throws(()=>x.scheduler.retryTask(task.id),/EFFECT_RECOVERY_REQUIRED/,'manual replay remains prohibited');
  }finally{x.close();}
});

test('D-023: recovery observation may run Root but cannot manufacture closure for the old effect',async()=>{
  let executions=0;
  const x=rig(async(task,callbacks)=>{
    executions+=1;
    if(executions===1){
      const value=attempt(task.id);
      callbacks.onEffectAttempt(value);
      callbacks.onExecutionStarted({role:'subagent'});
      return{kind:'suspended',reason:'unknown effect',snapshot:suspendedSnapshot(task.id)};
    }
    assert.equal(task.executionState?.retry?.scope,'effect-recovery-observe');
    callbacks.onExecutionStarted({role:'root'});
    return{kind:'goal_satisfied',proposal:{finalResult:'observed current reality',stageResult:null,summary:'observation turn finished'}};
  });
  try{
    const task=createTask(x.repository,'observe');
    await x.scheduler.tick();
    await x.scheduler.tick();
    const saved=x.repository.getTask(task.id);
    assert.equal(executions,2,'one fresh machine-side Root observation is admitted');
    assert.equal(saved.status,TaskStatus.READY);
    assert.equal(saved.ready_reason,ReadyReason.SUSPENDED);
    assert.equal(saved.executionState?.retry?.scope,'effect-recovery');
    assert.equal(saved.executionState?.retry?.paused,true);
    assert.equal(hasUnresolvedEffectRecovery(saved.executionState),true,'observation alone does not prove old effect outcome or liveness');
    assert.equal(hasCompetingEffectActuation(saved.executionState),true,'plain observation cannot remove the competing-actuation barrier');
  }finally{x.close();}
});

test('D-023: recovery observation hard-blocks a new effect admission while the old effect remains unresolved',async()=>{
  let executions=0;
  const x=rig(async(task,callbacks)=>{
    executions+=1;
    if(executions===1){
      const value=attempt(task.id);
      callbacks.onEffectAttempt(value);
      callbacks.onExecutionStarted({role:'subagent'});
      return{kind:'suspended',reason:'unknown effect',snapshot:suspendedSnapshot(task.id)};
    }
    callbacks.onExecutionStarted({role:'root'});
    assert.throws(
      ()=>callbacks.onEffectAttempt({...attempt(task.id),id:`effect:${task.id}:W-2:1`,workUnitId:'W-2',signature:'sig-2'}),
      /EFFECT_RECOVERY_ACTUATION_BLOCKED/,
      'fresh effect-capable control must remain fail-closed during recovery observation',
    );
    return{kind:'suspended',reason:'new effect correctly blocked',snapshot:suspendedSnapshot(task.id)};
  });
  try{
    const task=createTask(x.repository,'guard');
    await x.scheduler.tick();
    await x.scheduler.tick();
    const saved=x.repository.getTask(task.id);
    assert.equal(executions,2);
    assert.equal(unresolvedEffectAttempts(saved.executionState).length,1,'blocked recovery work cannot create a second durable effect attempt');
    assert.equal(saved.ready_reason,ReadyReason.SUSPENDED);
    assert.equal(saved.executionState?.retry?.scope,'effect-recovery');
  }finally{x.close();}
});

test('D-023: exact actuation closure preserves historical UNKNOWN but removes only the competing-actuation barrier',()=>{
  const state=addUnresolvedEffectAttempt(null,attempt('T-CLOSE'));
  const old=unresolvedEffectAttempts(state)[0];
  const closed=markEffectActuationClosed(state,{
    effectAttemptId:old.id,
    terminal:true,
    canMutate:false,
    evidenceIds:['E-CLOSURE'],
    observedAt:'2026-08-18T00:00:00.000Z',
  });
  const [saved]=unresolvedEffectAttempts(closed);
  assert.equal(hasUnresolvedEffectRecovery(closed),true,'historical outcome remains unresolved');
  assert.equal(hasCompetingEffectActuation(closed),false,'closed mutator no longer competes with fresh actuation');
  assert.equal(saved.resolved,false,'closure must not manufacture historical outcome resolution');
  assert.equal(saved.actuationClosed,true);
  assert.deepEqual(saved.actuationClosure?.evidenceIds,['E-CLOSURE']);
  assert.throws(()=>markEffectActuationClosed(state,{effectAttemptId:'wrong',terminal:true,canMutate:false,evidenceIds:['E-CLOSURE']}),/IDENTITY_MISMATCH/);
});

test('D-023: recovery cycle may admit a fresh effect after exact closure while retaining the old UNKNOWN history',async()=>{
  let executions=0;
  const x=rig(async(task,callbacks)=>{
    executions+=1;
    if(executions===1){
      const value=attempt(task.id);
      callbacks.onEffectAttempt(value);
      callbacks.onExecutionStarted({role:'subagent'});
      return{kind:'suspended',reason:'unknown effect',snapshot:suspendedSnapshot(task.id)};
    }
    callbacks.onExecutionStarted({role:'root'});
    const old=unresolvedEffectAttempts(task.executionState)[0];
    callbacks.onWorkReceipt({
      id:'W-CLOSURE',signature:'closure',workUnit:readOnlyWork(),
      result:{
        delegationId:'W-CLOSURE',result:'old mutator closed',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:'historical outcome remains unknown',
        effectActuationClosure:{effectAttemptId:old.id,terminal:true,canMutate:false,evidenceIds:['E-CLOSURE']},
      },
      completed_at:new Date().toISOString(),
    });
    const fresh={...attempt(task.id),id:`effect:${task.id}:W-2:1`,workUnitId:'W-2',signature:'sig-2'};
    callbacks.onEffectAttempt(fresh);
    callbacks.onWorkReceipt({
      id:'W-2',signature:'sig-2',effectAttemptId:fresh.id,workUnit:writeWork(),
      result:{delegationId:'W-2',result:'fresh done',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null},
      completed_at:new Date().toISOString(),
    });
    return{kind:'goal_satisfied',proposal:{finalResult:'fresh done',stageResult:null,summary:'fresh effect completed from stable current reality'}};
  });
  try{
    const task=createTask(x.repository,'closed-old-mutator');
    await x.scheduler.tick();
    await x.scheduler.tick();
    const saved=x.repository.getTask(task.id);
    assert.equal(executions,2);
    assert.equal(saved.status,TaskStatus.COMPLETED);
    assert.equal(saved.completion_reason,CompletionReason.SUCCESS);
    assert.equal(hasUnresolvedEffectRecovery(saved.executionState),true,'old historical outcome remains durably represented');
    assert.equal(hasCompetingEffectActuation(saved.executionState),false,'no competing mutator remains after exact closure');
    const old=unresolvedEffectAttempts(saved.executionState)[0];
    assert.equal(old.workUnitId,'W-1');
    assert.equal(old.actuationClosed,true);
    assert.equal(saved.workReceipts.some(item=>item.id==='W-2'&&item.effectAttemptId),true,'fresh effect keeps its own durable admission/receipt identity');
  }finally{x.close();}
});

test('D-023: restart converts ambiguous stale RUNNING into one bounded machine recovery observation',async()=>{
  let executions=0;
  const x=rig(async(task,callbacks)=>{
    executions+=1;
    assert.equal(task.executionState?.retry?.scope,'effect-recovery-observe');
    callbacks.onExecutionStarted({role:'root'});
    return{kind:'goal_satisfied',proposal:{finalResult:'observed',stageResult:null,summary:'observed'}};
  });
  try{
    const task=createTask(x.repository,'restart');
    x.repository.transitionTask(task.id,TaskStatus.RUNNING,{executionState:null});
    assert.equal(x.scheduler.recoverStaleRunningTasks(),1);
    let recovered=x.repository.getTask(task.id);
    assert.equal(recovered.status,TaskStatus.READY);
    assert.equal(recovered.ready_reason,ReadyReason.WAITING_RESOURCE);
    assert.equal(recovered.executionState?.retry?.scope,'effect-recovery-observe');
    assert.equal(hasUnresolvedEffectRecovery(recovered.executionState),true);

    await x.scheduler.tick();
    recovered=x.repository.getTask(task.id);
    assert.equal(executions,1);
    assert.equal(recovered.ready_reason,ReadyReason.SUSPENDED,'an unresolved stale attempt returns to safe suspension after the bounded observation');
    assert.equal(recovered.executionState?.retry?.scope,'effect-recovery');
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
    assert.equal(hasCompetingEffectActuation(saved.executionState),true);
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
