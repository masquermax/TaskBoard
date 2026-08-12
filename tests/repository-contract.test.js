import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskStatus, ReadyReason, CompletionReason, ProjectFilter } from '../src/core/types.js';

function projection(task) {
  return {
    id:task.id,title:task.title,instruction:task.instruction,status:task.status,
    ready_reason:task.ready_reason,completion_reason:task.completion_reason,
    executor_key:task.executor_key,locked:task.locked,deleted:Boolean(task.deleted_at),
    final_result:task.final_result,last_stage_result:task.last_stage_result,
    projectScopes:task.projectScopes,references:task.references.map(r=>({source_task_id:r.source_task_id,title:r.title,final_result:r.final_result})),
    attachments:task.attachments.map(a=>({id:a.id,name:a.name,mimeType:a.mimeType,size:a.size,path:a.path})),
    pendingGateway:task.pendingGateway?{status:task.pendingGateway.status,question:task.pendingGateway.question,targetGapId:task.pendingGateway.targetGapId??task.pendingGateway.target_gap_id??null,options:task.pendingGateway.options}:null,
    executionState:task.executionState,
  };
}

function runScenario(repo) {
  let now='2026-08-01T08:00:00.000Z';
  repo.now=()=>now;
  const project=repo.createProject({name:'OA',path:'D:/projects/oa'});
  const source=repo.createTask({
    title:'需求基线',instruction:'分析结果',projectId:project.id,executorKey:'mock',
    attachments:[{id:'A-1',name:'a.txt',mimeType:'text/plain',size:3,path:'D:/attachments/a.txt',createdAt:now}],
  });
  now='2026-08-01T09:00:00.000Z';
  repo.transitionTask(source.id,TaskStatus.COMPLETED,{completionReason:CompletionReason.SUCCESS,finalResult:'immutable result',lastStageResult:'stage'});
  repo.setLocked(source.id,true);

  now='2026-08-01T10:00:00.000Z';
  const target=repo.createTask({title:'开发任务',instruction:'基于需求开发',referenceTaskIds:[source.id],temporaryProjectPath:'D:/temp/work',executorKey:'mock'});
  repo.createGatewayRecord(target.id,{question:'确认范围?',context:'blocking',options:['A','B'],targetGapId:'G-SCOPE'});
  repo.resolveGatewayRecord(target.id,'A');
  repo.commitProgressHistory(target.id,{title:'附件事实',detail:'done',completedAt:now});
  repo.setExecutionState(target.id,{retry:{scope:'root',failureCount:1,paused:false,nextAt:'2026-08-01T11:00:00.000Z'}});
  repo.transitionTask(target.id,TaskStatus.RUNNING,{executionState:repo.getTask(target.id).executionState});
  repo.transitionTask(target.id,TaskStatus.READY,{readyReason:ReadyReason.WAITING_RESOURCE,executionState:repo.getTask(target.id).executionState});

  const result={
    project,
    source:projection(repo.getTask(source.id)),
    target:projection(repo.getTask(target.id)),
    ready:repo.listTasks({status:TaskStatus.READY,title:'开发',project:ProjectFilter.UNREGISTERED}).map(projection),
    completed:repo.listTasks({status:TaskStatus.COMPLETED}).map(projection),
    phases:repo.getPhaseHistory(target.id),
    progress:repo.getProgressHistory(target.id).map(x=>({title:x.title,detail:x.detail,completed_at:x.completed_at})),
    gateways:repo.listGatewayHistory(target.id).map(x=>({status:x.status,question:x.question,targetGapId:x.targetGapId??x.target_gap_id??null,answer:x.answer,options:x.options})),
    counts:repo.counts(),
  };
  repo.setMaintenanceState('x',{a:1});
  result.maintenance=repo.getMaintenanceState('x');
  assert.equal(repo.hardDeleteCompletedTask(source.id),false,'locked/referenced Result must be protected');
  return result;
}

test('JSON repository preserves the complete Task persistence contract',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-repo-parity-'));
  const jsonDb=new JsonTaskDatabase(join(dir,'taskboard.json'));
  try{
    const result=runScenario(new JsonTaskRepository(jsonDb));
    assert.equal(result.target.ready_reason,ReadyReason.WAITING_RESOURCE);
    assert.equal(result.gateways[0].targetGapId,'G-SCOPE');
    assert.equal(result.maintenance.a,1);
  }finally{
    jsonDb.close();rmSync(dir,{recursive:true,force:true});
  }
});

test('removing a Project List entry keeps existing Task scope but classifies it as unregistered',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-project-removal-'));
  const jsonDb=new JsonTaskDatabase(join(dir,'taskboard.json'));
  const check=repo=>{
    const project=repo.createProject({name:'Old OA',path:'D:/projects/old-oa'});
    const task=repo.createTask({title:'Existing task',instruction:'keep scope',projectId:project.id});
    repo.deleteProject(project.id);
    const hydrated=repo.getTask(task.id);
    assert.equal(hydrated.projectScopes.length,1);
    assert.equal(hydrated.projectScopes[0].source,'registry');
    assert.equal(hydrated.projectScopes[0].projectId,null);
    assert.equal(hydrated.projectScopes[0].path,'D:/projects/old-oa');
    assert.deepEqual(repo.listTasks({status:TaskStatus.READY,project:ProjectFilter.UNREGISTERED}).map(t=>t.id),[task.id]);
  };
  try{check(new JsonTaskRepository(jsonDb));}
  finally{jsonDb.close();rmSync(dir,{recursive:true,force:true});}
});

test('commitProgressHistory atomically writes History and last_stage_result',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-history-atomic-'));
  const jsonDb=new JsonTaskDatabase(join(dir,'taskboard.json'));
  try{
    const repo=new JsonTaskRepository(jsonDb);
    const task=repo.createTask({title:'History atomic',instruction:'test'});
    repo.commitProgressHistory(task.id,{title:'项目证据已确认',detail:'OA→ERP 链路已确认。',completedAt:'2026-08-09T10:00:00.000Z'});
    assert.deepEqual(repo.getProgressHistory(task.id).map(x=>({title:x.title,detail:x.detail})),[{title:'项目证据已确认',detail:'OA→ERP 链路已确认。'}]);
    assert.equal(repo.getTask(task.id).last_stage_result,'OA→ERP 链路已确认。');
  }finally{jsonDb.close();rmSync(dir,{recursive:true,force:true});}
});

test('History commit failure does not leave a partial JSON record',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-history-rollback-'));
  const jsonDb=new JsonTaskDatabase(join(dir,'taskboard.json'));
  try{
    const jsonRepo=new JsonTaskRepository(jsonDb);const jt=jsonRepo.createTask({title:'JSON rollback',instruction:'test'});
    const realPersist=jsonDb.persist.bind(jsonDb);let fail=true;
    jsonDb.persist=()=>{if(fail)throw new Error('forced persist failure');return realPersist();};
    assert.throws(()=>jsonRepo.commitProgressHistory(jt.id,{title:'x',detail:'y'}),/forced persist failure/);
    fail=false;jsonDb.persist=realPersist;
    assert.equal(jsonRepo.getProgressHistory(jt.id).length,0);
    assert.equal(jsonRepo.getTask(jt.id).last_stage_result,null);

  }finally{jsonDb.close();rmSync(dir,{recursive:true,force:true});}
});


test('legacy runtime snapshot and RESOURCE_WAIT are normalized at the Repository boundary only',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-runtime-migration-'));
  try{
    const file=join(dir,'legacy.json');
    writeFileSync(file,JSON.stringify({
      counters:{task:1},projects:[],phaseHistory:[],scopes:[],references:[],gateways:[],attachments:[],progressHistory:[],maintenance:{},
      tasks:[{id:'T-0001',title:'legacy',instruction:'x',status:'READY',ready_reason:'RESOURCE_WAIT',status_entered_at:'2026-08-01T00:00:00.000Z',created_at:'2026-08-01T00:00:00.000Z',completed_at:null,completion_reason:null,last_stage_result:null,final_result:null,executor_key:'default',locked:false,deleted_at:null,cancel_requested_at:null,analysis_state:null,execution_state:{snapshot:{taskId:'T-0001',root:{title:'Validator 认证',status:'RUNNING',ownerType:'validator',ownerLabel:'Validator'},stage:{id:'s',workUnits:[{id:'w',title:'x',status:'RUNNING',ownerType:'subagent',ownerLabel:'Subagent'}]},completedWorkUnits:[]}}}],
    },null,2));
    const db=new JsonTaskDatabase(file);const repo=new JsonTaskRepository(db);
    const task=repo.getTask('T-0001');
    assert.equal(task.ready_reason,'WAITING_RESOURCE');
    assert.equal(task.executionState.snapshot.actor.owner,'validator');
    assert.equal('root' in task.executionState.snapshot,false);
    assert.equal(task.executionState.snapshot.stage.workUnits[0].owner,'subagent');
    assert.equal('ownerType' in task.executionState.snapshot.stage.workUnits[0],false);
    db.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});
