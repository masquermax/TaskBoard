import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { ModelRouter } from '../src/core/model-router.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { Scheduler } from '../src/core/scheduler.js';
import { TaskStatus } from '../src/core/types.js';
import { classifyRetry } from '../src/core/retry-policy.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

// Coding Recovery Slice — behavior contract probes.
//
// These tests intentionally assert externally meaningful recovery behavior, not a
// proposed Attempt/Fence/EffectStatus schema. The first tranche is expected to
// contain Contract REDs on the current Runtime. A RED is useful only when the
// fixture can manufacture the failure boundary deterministically.
//
// Coverage map for the frozen attack scenarios:
//   #1  RED below — effect happened + transport disconnect must not duplicate.
//   #2  RED below — process restart must recover from durable truth, not replay.
//   #3  Existing scheduler/runtime tests already prove pre-execution capacity
//       shortage can wait and auto-continue; do not replace recovery with STOP.
//   #4  Existing completion-work-occurrence-phase4 tests prove execution count
//       does not satisfy the Goal.
//   #5  TODO below — no stable idempotency-proof semantic seam exists yet.
//   #6  RED below — network-only effects are also subject to no-blind-replay.
//   #7  GREEN truth guard below — changed reality alone creates no WorkReceipt.
//   #8  TODO below — no mutation-time relevant-precondition seam exists yet.
//   #9  TODO below — unresolved recovery truth has no durable behavior surface yet.
//   #10 RED + GREEN scope pair below — same-scope split brain blocks, unrelated
//       scope must remain autonomous.
//
// Every scenario is evaluated along four dimensions: Safety, Truth, Autonomy,
// and Scope. Safety must not be obtained by making every transport error
// non-retryable or by globally freezing unrelated work.

function complete(result='done') {
  return {
    kind:'complete', summary:'ok', stageResult:'ok', finalResult:result,
    confirmed:[], recommendations:[], openQuestions:[], gateway:null, delegations:[],
  };
}

function delegated(workUnit) {
  return {
    kind:'delegate', summary:'delegate', stageResult:null, finalResult:null,
    confirmed:[], recommendations:[], openQuestions:[], gateway:null,
    delegations:[workUnit],
  };
}

function workUnit({id='W-1', projectAccess='write', networkAccess=false, inputRefs=['project:0']}={}) {
  return {
    id,
    title:`work ${id}`,
    instruction:`execute ${id}`,
    goal:`finish ${id}`,
    expectedOutput:`result ${id}`,
    stopCondition:`${id} is finished or a bounded Gap is proven`,
    projectAccess,
    networkAccess,
    skillId:null,
    dependsOn:[],
    inputRefs,
  };
}

function singleWorkExecutor(unit, runSubagent) {
  return {
    async runRoot({subagentResults,onExecutionStarted}) {
      onExecutionStarted?.();
      if (!subagentResults.length) return delegated(unit);
      return complete();
    },
    runSubagent,
  };
}

function rig(executor,{dir=null,retryDelaysMs=[0,0,0,0],taskConcurrency=2}={}) {
  const ownedDir=!dir;
  const rootDir=dir||mkdtempSync(join(tmpdir(),'taskboard-recovery-contract-'));
  const dbFile=join(rootDir,'db.json');
  const db=new JsonTaskDatabase(dbFile);
  const repo=new JsonTaskRepository(db);
  const service=new TaskService(repo);
  const router=new ModelRouter();
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({
    ...successfulCompletionDependenciesForControlFlowTest(),
    executor,
    modelRouter:router,
    subagentRuntime:subagent,
    retryDelaysMs,
  });
  const scheduler=new Scheduler({
    repository:repo,
    taskService:service,
    rootRuntime:root,
    maxConcurrentTasks:taskConcurrency,
    retryDelaysMs,
    intervalMs:999999,
  });
  return {
    dir:rootDir,dbFile,db,repo,service,root,scheduler,
    close({remove=ownedDir}={}) {
      scheduler.stop();
      db.close();
      if (remove) rmSync(rootDir,{recursive:true,force:true});
    },
  };
}

function projectIn(dir,name='project') {
  const path=join(dir,name);
  mkdirSync(path,{recursive:true});
  return path;
}

function transportDisconnect() {
  return new Error('stream disconnected before completion: error sending request for url');
}

async function drive(scheduler,turns=8) {
  for (let i=0;i<turns;i+=1) await scheduler.tick();
}

test('Scenario 1 — effect happened + transport disconnect: the same mutation is not blindly replayed',async()=>{
  // Given: one write-capable Work Unit whose remote effect happens before the
  // control channel reports a transport failure.
  let attempts=0;
  let mutations=0;
  const unit=workUnit();
  const executor=singleWorkExecutor(unit,async({onExecutionStarted})=>{
    attempts+=1;
    onExecutionStarted?.();
    mutations+=1; // deterministic reality change happened before disconnect
    throw transportDisconnect();
  });
  const x=rig(executor);
  try {
    const project=projectIn(x.dir);
    x.scheduler.createTask({title:'no blind replay',instruction:'modify project once',temporaryProjectPath:project});

    // When: Scheduler gets repeated chances to recover/retry.
    await drive(x.scheduler);

    // Then — Safety: one admitted real effect must not become multiple effects
    // merely because the result channel was lost.
    assert.equal(mutations,1,'an UNKNOWN effect outcome must not be translated into NOT_APPLIED and replayed');
    assert.ok(attempts>=1);
  } finally { x.close(); }
});

test('Scenario 2 — restart crosses the memory boundary: stale RUNNING work must not replay a previously applied effect',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-recovery-restart-'));
  const project=projectIn(dir);
  const reality=join(project,'effect.log');
  writeFileSync(reality,'old-attempt-effect\n','utf8');

  // Runtime A: durable lifecycle says RUNNING, the external effect already
  // exists, and there is deliberately no successful WorkReceipt.
  const inert={async runRoot(){throw new Error('unused');},async runSubagent(){throw new Error('unused');}};
  const a=rig(inert,{dir});
  const task=a.scheduler.createTask({title:'restart recovery',instruction:'ensure one effect',temporaryProjectPath:project});
  a.repo.transitionTask(task.id,TaskStatus.RUNNING,{executionState:null});
  assert.equal(a.repo.getTask(task.id).workReceipts.length,0);
  a.close({remove:false}); // Runtime A and all in-memory session state disappear.

  // Runtime B: constructed only from the durable JSON repository.
  let newMutations=0;
  const unit=workUnit();
  const executor=singleWorkExecutor(unit,async({delegation,onExecutionStarted})=>{
    onExecutionStarted?.();
    newMutations+=1;
    appendFileSync(reality,`${delegation.id}-replayed\n`,'utf8');
    return {delegationId:delegation.id,result:'done',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};
  });
  const b=rig(executor,{dir});
  try {
    // When: startup recovery sees the stale RUNNING Task and the Scheduler runs.
    assert.equal(b.scheduler.recoverStaleRunningTasks(),1);
    await drive(b.scheduler,3);

    // Then — Safety + durable recovery: Runtime B must not infer from missing
    // in-memory state / missing receipt that the prior effect never happened.
    const effects=readFileSync(reality,'utf8').trim().split(/\r?\n/).filter(Boolean);
    assert.equal(effects.length,1,'restart must reconcile durable unresolved reality before any repeat mutation');
    assert.equal(newMutations,0);
  } finally { b.close({remove:true}); }
});

test('Scenario 6 — network-only effect: no-blind-replay is not a synonym for projectAccess=write',async()=>{
  let calls=0;
  let externalPosts=0;
  const unit=workUnit({projectAccess:'none',networkAccess:true,inputRefs:[]});
  const executor=singleWorkExecutor(unit,async({onExecutionStarted})=>{
    calls+=1;
    onExecutionStarted?.();
    externalPosts+=1; // e.g. POST /ticket happened before the response channel died
    throw transportDisconnect();
  });
  const x=rig(executor);
  try {
    x.scheduler.createTask({title:'network effect',instruction:'perform one external mutation'});
    await drive(x.scheduler);
    assert.equal(externalPosts,1,'generic effect safety must also protect non-filesystem mutation surfaces');
    assert.ok(calls>=1);
  } finally { x.close(); }
});

test('Scenario 7 truth guard — changed reality without a successful result is not automatically attributed as a WorkReceipt',async()=>{
  const unit=workUnit();
  const executor=singleWorkExecutor(unit,async({onExecutionStarted})=>{
    onExecutionStarted?.();
    const error=new Error('controlled observation channel failure');
    error.nonRetryable=true;
    throw error;
  });
  const x=rig(executor);
  try {
    const project=projectIn(x.dir);
    const reality=join(project,'foo.js');
    writeFileSync(reality,'A\n','utf8');
    const task=x.scheduler.createTask({title:'attribution guard',instruction:'inspect current reality',temporaryProjectPath:project});

    // Given: a third party changes the reality independently of this Attempt.
    writeFileSync(reality,'B\n','utf8');
    await x.scheduler.tick();

    // Truth: observing B must never be sufficient by itself to manufacture a
    // successful execution receipt for the interrupted Attempt.
    assert.equal(readFileSync(reality,'utf8'),'B\n');
    assert.equal(x.repo.getTask(task.id).workReceipts.length,0);
    assert.notEqual(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  } finally { x.close(); }
});

test('Scenario 10A — stale remote mutator on the same effect scope blocks a competing mutation',async()=>{
  let attempt=0;
  let oldMutatorMayStillAct=false;
  let competingStarts=0;
  const unit=workUnit();
  const executor=singleWorkExecutor(unit,async({onExecutionStarted})=>{
    attempt+=1;
    onExecutionStarted?.();
    if (attempt===1) {
      // The TaskBoard-facing call fails, but a simulated remote mutator remains
      // alive outside that failed control channel.
      oldMutatorMayStillAct=true;
      throw transportDisconnect();
    }
    if (oldMutatorMayStillAct) competingStarts+=1;
    throw transportDisconnect();
  });
  const x=rig(executor);
  try {
    const project=projectIn(x.dir);
    x.scheduler.createTask({title:'split brain X',instruction:'mutate X once',temporaryProjectPath:project});
    await drive(x.scheduler);

    assert.equal(competingStarts,0,'same-scope mutation must wait for quiescence, fencing, isolation, or equivalent proof');
  } finally { x.close(); }
});

test('Scenario 10B autonomy/scope guard — an unresolved mutator in project X must not freeze independent project Y',async()=>{
  const executor={
    async runRoot({task,subagentResults,onExecutionStarted}) {
      onExecutionStarted?.();
      if (!subagentResults.length) return delegated(workUnit({id:`W-${task.title}`}));
      return complete();
    },
    async runSubagent({task,delegation,onExecutionStarted}) {
      onExecutionStarted?.();
      if (task.title==='X') throw transportDisconnect();
      return {delegationId:delegation.id,result:'Y done',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};
    },
  };
  const x=rig(executor,{taskConcurrency:2});
  try {
    const projectX=projectIn(x.dir,'project-x');
    const projectY=projectIn(x.dir,'project-y');
    x.scheduler.createTask({title:'X',instruction:'mutate X',temporaryProjectPath:projectX});
    const y=x.scheduler.createTask({title:'Y',instruction:'mutate Y',temporaryProjectPath:projectY});

    await drive(x.scheduler);

    assert.equal(x.service.getTask(y.id).status,TaskStatus.COMPLETED,'local recovery uncertainty must not become a global Task/Project freeze');
  } finally { x.close(); }
});

test('anti-cheat guard — transport classification stays retryable; effect safety must not be faked by turning disconnects into blanket nonRetryable errors',()=>{
  const classified=classifyRetry(transportDisconnect());
  assert.equal(classified.retryable,true);
});

test.todo('Scenario 5 — stable idempotency proof must cause automatic safe continuation; add only after a semantic Executor proof seam exists');
test.todo('Scenario 8 — stale relevant preconditions must block mutation; add only after a mutation-time observation/precondition seam exists');
test.todo('Scenario 9 — Cancel stops new business mutation but preserves unresolved recovery truth/evidence across cleanup; add after a durable recovery behavior seam exists');
