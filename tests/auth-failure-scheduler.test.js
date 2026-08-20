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
import { TaskStatus, ReadyReason, WorkUnitStatus } from '../src/core/types.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

function rig(executor){
  const dir=mkdtempSync(join(tmpdir(),'taskboard-auth-scheduler-')),db=new JsonTaskDatabase(join(dir,'db.json')),repo=new JsonTaskRepository(db),service=new TaskService(repo),modelRouter=new ModelRouter(),subagentRuntime=new SubagentRuntime({executor,modelRouter}),rootRuntime=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter,subagentRuntime,retryDelaysMs:[0,0,0,0]}),scheduler=new Scheduler({repository:repo,taskService:service,rootRuntime,intervalMs:999999,retryDelaysMs:[0,0,0,0]});
  return{repo,service,scheduler,close(){scheduler.stop();db.close();rmSync(dir,{recursive:true,force:true});}};
}

test('revoked Codex refresh token suspends the Root after the first real attempt and never enters automatic retry',async()=>{
  let calls=0;
  const executor={async runRoot(){calls+=1;throw new Error('Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.');},async runSubagent(){throw new Error('unused');}};
  const x=rig(executor);
  try{
    const task=x.scheduler.createTask({title:'账号失效',instruction:'验证认证失败不会自动重试'});await x.scheduler.tick();const current=x.service.getTask(task.id);
    assert.equal(calls,1);assert.equal(current.status,TaskStatus.READY);assert.equal(current.ready_reason,ReadyReason.SUSPENDED);assert.equal(current.executionState.retry.scope,'root');assert.equal(current.executionState.retry.failureCount,1);assert.equal(current.executionState.retry.paused,true);assert.equal(current.executionState.retry.reason,'执行环境需要重新登录或授权');
    const snapshot=current.executionState.snapshot;assert.equal(snapshot.stage,null,'Root failure is not a synthetic Work Unit stage');assert.equal(snapshot.actor.owner,'root');assert.equal(snapshot.actor.status,WorkUnitStatus.SUSPENDED);assert.equal(snapshot.actor.failureCount,1);assert.match(snapshot.actor.detail,/继续自动重试无法解决/);
    for(let i=0;i<3;i+=1)await x.scheduler.tick();assert.equal(calls,1,'SUSPENDED auth failure blocks automatic retry until explicit user action');
  }finally{x.close();}
});
