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
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

// Coding Recovery Slice — behavior contract probes.
// Assert externally meaningful recovery outcomes, not a proposed Attempt/Fence
// schema. A RED is trustworthy only when the fixture crosses the intended
// failure boundary under the real D-017 Authority derivation path.
//
// Coverage map:
//   #1  RED target — effect happened + transport disconnect must not duplicate.
//   #2  RED target — process restart must recover durable truth before replay.
//   #3  Existing capacity tests prove safely unavailable work auto-continues.
//   #4  Existing Completion tests prove execution count does not satisfy Goal.
//   #5  TODO — no stable idempotency-proof semantic seam exists yet.
//   #6  RED target — network-only effects are subject to no-blind-replay.
//   #7  GREEN truth guard — reality change alone creates no WorkReceipt.
//   #8  TODO — no mutation-time relevant-precondition seam exists yet.
//   #9  TODO — unresolved recovery truth has no durable behavior surface yet.
//   #10 RED + GREEN scope pair — same-scope split brain blocks; independent Y
//       must remain autonomous.
//
// Observe Safety, Truth, Autonomy and Scope. Safety must not be obtained by
// making every transport error non-retryable or globally freezing unrelated work.

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
  const governanceCompiler=new GovernanceCompiler({rootDir:process.cwd()});
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({
    ...successfulCompletionDependenciesForControlFlowTest(),
    executor,
    modelRouter:router,
    subagentRuntime:subagent,
    governanceCompiler,
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

function authorityItem(task,value) {
  const requirement_refs=(task.taskContract?.requirementRefs||[]).map(ref=>({
    source_id:ref.sourceId,
    start:ref.start,
    end:ref.end,
  }));
  return {value,certification:'supported',requirement_refs};
}

function certifyTaskAuthority(x,taskId,{projectWrite=false,networkAccess=false}={}) {
  const task=x.repo.getTask(taskId);
  const authority={networkAccess:authorityItem(task,networkAccess)};
  if ((task.projectScopes||[]).length) authority.projectWrite=authorityItem(task,projectWrite);
  x.repo.commitTaskContractAuthority(taskId,authority);
  return x.repo.getTask(taskId);
}

function createAuthorizedTask(x,input,authority={}) {
  const created=x.scheduler.createTask(input);
  return certifyTaskAuthority(x,created.id,authority);
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
    createAuthorizedTask(x,{title:'no blind replay',instruction:'modify project once',temporaryProjectPath:project},{projectWrite:true});
    await drive(x.scheduler);
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
  const task=createAuthorizedTask(a,{title:'restart recovery',instruction:'ensure one project effect',temporaryProjectPath:project},{projectWrite:true});
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
    assert.equal(b.scheduler.recoverStaleRunningTasks(),1);
    await drive(b.scheduler,3);
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
    createAuthorizedTask(x,{title:'network effect',instruction:'perform one external network mutation'},{networkAccess:true});
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
    const task=createAuthorizedTask(x,{title:'attribution guard',instruction:'inspect and potentially modify current project reality',temporaryProjectPath:project},{projectWrite:true});
    writeFileSync(reality,'B\n','utf8'); // third-party change
    await x.scheduler.tick();
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
      oldMutatorMayStillAct=true;
      throw transportDisconnect();
    }
    if (oldMutatorMayStillAct) competingStarts+=1;
    throw transportDisconnect();
  });
  const x=rig(executor);
  try {
    const project=projectIn(x.dir);
    createAuthorizedTask(x,{title:'split brain X',instruction:'mutate project X once',temporaryProjectPath:project},{projectWrite:true});
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
    createAuthorizedTask(x,{title:'X',instruction:'mutate project X',temporaryProjectPath:projectX},{projectWrite:true});
    const y=createAuthorizedTask(x,{title:'Y',instruction:'mutate project Y',temporaryProjectPath:projectY},{projectWrite:true});
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
