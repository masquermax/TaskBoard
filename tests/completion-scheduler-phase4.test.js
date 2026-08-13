import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { Scheduler } from '../src/core/scheduler.js';
import { TaskStatus, CompletionReason } from '../src/core/types.js';

test('Scheduler projects goal_satisfied into explicit SUCCESS lifecycle without deriving GoalState',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-phase4-scheduler-'));
  try{
    const db=new JsonTaskDatabase(join(dir,'state.json'));
    const repository=new JsonTaskRepository(db);
    const task=repository.createTask({title:'done',instruction:'完成这个任务'});
    let cleaned=0;
    const rootRuntime={executor:{readiness:()=>({ready:true})},snapshot:()=>null,isQuiescent:()=>true,discardSession:()=>{},cleanupTaskWorkspace:()=>{cleaned+=1;},async execute(_task,{onExecutionStarted}){onExecutionStarted({role:'validator'});return{kind:'goal_satisfied',goalState:'satisfied',proposal:{finalResult:'certified result',summary:'certified summary',stageResult:'certified stage'},assessments:[{id:'ASSESS:GOAL',certification:'supported'}],quiescent:true};}};
    const scheduler=new Scheduler({repository,taskService:{},rootRuntime});
    await scheduler.runClaimed(task.id);
    const done=repository.getTask(task.id);
    assert.equal(done.status,TaskStatus.COMPLETED);
    assert.equal(done.completion_reason,CompletionReason.SUCCESS);
    assert.equal(done.final_result,'certified result');
    assert.equal(done.last_stage_result,'certified stage');
    assert.equal(cleaned,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
