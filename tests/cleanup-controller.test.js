import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { DailyCleanupController } from '../src/core/cleanup-controller.js';
import { AttachmentStore } from '../src/core/attachment-store.js';
import { TaskStatus } from '../src/core/types.js';

function rig() {
  const dir=mkdtempSync(join(tmpdir(),'taskboard-cleanup-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));
  const repo=new JsonTaskRepository(db);
  return {dir,db,repo,close(){db.close();rmSync(dir,{recursive:true,force:true});}};
}
function daysBefore(today,days){const d=new Date(today);d.setDate(d.getDate()-days);return d;}
function completedAt(repo,{title,at,locked=false,referenceTaskIds=[]}){
  const task=repo.createTask({title,instruction:title,referenceTaskIds});
  repo.transitionTask(task.id,TaskStatus.COMPLETED,{finalResult:'done'});
  repo.store.transaction(()=>{
    const row=repo.state.tasks.find(x=>x.id===task.id);
    row.completed_at=at.toISOString();row.status_entered_at=at.toISOString();row.locked=locked;
  });
  return repo.getTask(task.id);
}
function createController(repo,{now,attachmentStore={removeTaskAttachments(){}}}={}){
  return new DailyCleanupController({
    repository:repo,attachmentStore,now,
    retryIntervalMs:60*60*1000,
    setTimeoutFn:()=>({unref(){}}),clearTimeoutFn:()=>{},
  });
}

test('90-day cleanup is date-only: day 90 is retained and day 91 is eligible', async()=>{
  const x=rig();
  const today=new Date(2026,7,8,12,30,0);
  try{
    const d90=completedAt(x.repo,{title:'day90',at:daysBefore(today,90)});
    const d91=completedAt(x.repo,{title:'day91',at:daysBefore(today,91)});
    const candidates=x.repo.listCleanupCandidates({today,maxAgeDays:90});
    assert.deepEqual(candidates.map(t=>t.id),[d91.id]);
    const cleanup=createController(x.repo,{now:()=>new Date(today)});
    const result=await cleanup.trigger('test');
    assert.equal(result.ok,true);assert.equal(result.deleted,1);
    assert.ok(x.repo.getTask(d90.id));
    assert.equal(x.repo.getTask(d91.id),null);
  }finally{x.close();}
});

test('cleanup touches only COMPLETED and protects locked and referenced completed Results',async()=>{
  const x=rig();const today=new Date(2026,7,8,9,0,0);const old=daysBefore(today,120);
  try{
    const normal=completedAt(x.repo,{title:'normal old',at:old});
    const locked=completedAt(x.repo,{title:'locked old',at:old,locked:true});
    const source=completedAt(x.repo,{title:'referenced source',at:old});
    x.repo.createTask({title:'dependent task',instruction:'uses result',referenceTaskIds:[source.id]});
    const ready=x.repo.createTask({title:'old ready',instruction:'still live'});
    x.repo.store.transaction(()=>{const row=x.repo.state.tasks.find(t=>t.id===ready.id);row.created_at=old.toISOString();row.status_entered_at=old.toISOString();});
    const cleanup=createController(x.repo,{now:()=>new Date(today)});
    const result=await cleanup.trigger('test');
    assert.equal(result.ok,true);assert.equal(result.deleted,1);
    assert.equal(x.repo.getTask(normal.id),null);
    assert.ok(x.repo.getTask(locked.id));
    assert.ok(x.repo.getTask(source.id));
    assert.ok(x.repo.getTask(ready.id));
  }finally{x.close();}
});

test('one successful cleanup per local day: later triggers skip',async()=>{
  const x=rig();let now=new Date(2026,7,8,1,0,0);let calls=0;
  const original=x.repo.listCleanupCandidates.bind(x.repo);x.repo.listCleanupCandidates=(args)=>{calls++;return original(args);};
  try{
    const cleanup=createController(x.repo,{now:()=>new Date(now)});
    const first=await cleanup.trigger('startup-settled');
    const second=await cleanup.trigger('daily-01:00');
    assert.equal(first.ok,true);assert.equal(second.skipped,true);assert.equal(second.reason,'ALREADY_SUCCEEDED_TODAY');assert.equal(calls,1);
    const state=x.repo.getMaintenanceState('daily_cleanup');assert.equal(state.lastSuccessDate,'2026-08-08');
  }finally{x.close();}
});

test('cleanup persistence/database error aborts run, never records success, and releases the running lock',async()=>{
  const x=rig();let now=new Date(2026,7,8,2,0,0);let fail=true;
  const original=x.repo.listCleanupCandidates.bind(x.repo);x.repo.listCleanupCandidates=(args)=>{if(fail)throw new Error('database read failed');return original(args);};
  try{
    const cleanup=createController(x.repo,{now:()=>new Date(now)});
    const first=await cleanup.trigger('test');
    assert.equal(first.ok,false);assert.equal(first.attemptCount,1);
    let state=x.repo.getMaintenanceState('daily_cleanup');assert.notEqual(state.lastSuccessDate,'2026-08-08');assert.equal(state.attemptCount,1);assert.match(state.lastError,/database read failed/);
    assert.equal(cleanup.running,false);
    fail=false;now=new Date(state.nextRetryAt);
    const second=await cleanup.trigger('hourly-retry');
    assert.equal(second.ok,true);assert.equal(second.attemptCount,2);
    state=x.repo.getMaintenanceState('daily_cleanup');assert.equal(state.lastSuccessDate,'2026-08-08');
  }finally{x.close();}
});

test('cleanup retry count is shared and hard-capped at five total attempts; a sixth trigger cannot run',async()=>{
  const x=rig();let now=new Date(2026,7,8,1,0,0);let calls=0;
  x.repo.listCleanupCandidates=()=>{calls++;throw new Error('temporary database busy');};
  try{
    let cleanup=createController(x.repo,{now:()=>new Date(now)});
    for(let expected=1;expected<=5;expected++){
      const result=await cleanup.trigger(expected===1?'daily-01:00':'hourly-retry');
      assert.equal(result.ok,false);assert.equal(result.attemptCount,expected);
      const state=x.repo.getMaintenanceState('daily_cleanup');
      assert.equal(state.attemptCount,expected);
      if(expected<5){assert.ok(state.nextRetryAt);now=new Date(state.nextRetryAt);if(expected===2){cleanup=createController(x.repo,{now:()=>new Date(now)});}}
      else assert.equal(state.nextRetryAt,null);
    }
    const sixth=await cleanup.trigger('restart-or-extra-trigger');
    assert.equal(sixth.skipped,true);assert.equal(sixth.reason,'ATTEMPT_LIMIT_REACHED');assert.equal(calls,5);
    assert.notEqual(x.repo.getMaintenanceState('daily_cleanup').lastSuccessDate,'2026-08-08');
  }finally{x.close();}
});

test('a failure before initial attempt-state persistence does not wedge cleanup as permanently running',async()=>{
  const x=rig();let now=new Date(2026,7,8,3,0,0);const realSet=x.repo.setMaintenanceState.bind(x.repo);let first=true;
  x.repo.setMaintenanceState=(key,value)=>{if(first){first=false;throw new Error('database write failed');}return realSet(key,value);};
  try{
    const cleanup=createController(x.repo,{now:()=>new Date(now)});
    const result=await cleanup.trigger('startup-settled');
    assert.equal(result.ok,false);assert.equal(cleanup.running,false);
    const state=x.repo.getMaintenanceState('daily_cleanup');assert.equal(state.attemptCount,1);assert.match(state.lastError,/database write failed/);
  }finally{x.close();}
});

test('daily cleanup schedule targets the next local 01:00, not a rolling 24-hour interval',()=>{
  const x=rig();
  try{
    let now=new Date(2026,7,8,0,30,0,0);let captured=null;
    const cleanup=new DailyCleanupController({repository:x.repo,attachmentStore:{removeTaskAttachments(){}},now:()=>new Date(now),setTimeoutFn:(fn,delay)=>{captured=delay;return{unref(){}};},clearTimeoutFn:()=>{}});
    cleanup.startDailySchedule();
    assert.equal(captured,30*60*1000);
    cleanup.stop();
    now=new Date(2026,7,8,2,0,0,0);captured=null;
    const cleanup2=new DailyCleanupController({repository:x.repo,attachmentStore:{removeTaskAttachments(){}},now:()=>new Date(now),setTimeoutFn:(fn,delay)=>{captured=delay;return{unref(){}};},clearTimeoutFn:()=>{}});
    cleanup2.startDailySchedule();
    assert.equal(captured,23*60*60*1000);
    cleanup2.stop();
  }finally{x.close();}
});


test('cleanup restores staged attachment files when database deletion fails before commit',async()=>{
  const x=rig();const today=new Date(2026,7,8,4,0,0);const old=daysBefore(today,120);
  const attachmentRoot=join(x.dir,'attachments');
  const store=new AttachmentStore({rootDir:attachmentRoot});
  try{
    const staged=store.persist([{name:'proof.txt',type:'text/plain',data:Buffer.from('evidence')}]);
    const task=x.repo.createTask({title:'old with attachment',instruction:'old',attachments:staged.attachments});
    x.repo.transitionTask(task.id,TaskStatus.COMPLETED,{finalResult:'done'});
    x.repo.store.transaction(()=>{const row=x.repo.state.tasks.find(t=>t.id===task.id);row.completed_at=old.toISOString();row.status_entered_at=old.toISOString();});
    const path=x.repo.getTask(task.id).attachments[0].path;
    const realDelete=x.repo.hardDeleteCompletedTask.bind(x.repo);
    x.repo.hardDeleteCompletedTask=()=>{throw new Error('database delete failed');};
    const cleanup=createController(x.repo,{now:()=>new Date(today),attachmentStore:store});
    const result=await cleanup.trigger('test');
    assert.equal(result.ok,false);
    assert.ok(x.repo.getTask(task.id),'database record must remain');
    assert.equal(readFileSync(path,'utf8'),'evidence','attachment must be restored when DB deletion aborts');
    assert.equal((await import('node:fs')).readdirSync(attachmentRoot).some(name=>name.startsWith('.cleanup-')),false);
    x.repo.hardDeleteCompletedTask=realDelete;
  }finally{x.close();}
});

test('cleanup purges leftover .cleanup-* directories before declaring the run successful',async()=>{
  const x=rig();const today=new Date(2026,7,8,5,0,0);const attachmentRoot=join(x.dir,'attachments');const store=new AttachmentStore({rootDir:attachmentRoot});
  try{
    const orphan=join(attachmentRoot,'.cleanup-orphan-test');
    (await import('node:fs')).mkdirSync(orphan,{recursive:true});writeFileSync(join(orphan,'old.bin'),'x');
    assert.equal(existsSync(orphan),true);
    const cleanup=createController(x.repo,{now:()=>new Date(today),attachmentStore:store});
    const result=await cleanup.trigger('test');
    assert.equal(result.ok,true);
    assert.equal(existsSync(orphan),false);
  }finally{x.close();}
});
