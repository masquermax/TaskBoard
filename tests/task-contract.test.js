import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { createInitialTaskContractState, bootstrapTaskContractState } from '../src/governance/task-contract.js';

const temp=()=>{const dir=mkdtempSync(join(tmpdir(),'task-contract-'));const file=join(dir,'db.json');const db=new JsonTaskDatabase(file);const repo=new JsonTaskRepository(db);return{dir,file,db,repo,service:new TaskService(repo)}};

test('TaskContract starts with immutable requirement provenance only',()=>{const s=createInitialTaskContractState({taskId:'T-1',instruction:'check A',createdAt:'2026-08-13T00:00:00Z'});assert.equal(s.requirement_sources[0].text,'check A');assert.deepEqual(s.task_contract.requirement_refs,[{source_id:'REQ-T-1-0001',start:0,end:7}]);assert.equal(s.task_contract.revision,1);assert.equal('goal_state' in s.task_contract,false);});

test('new tasks persist TaskContract without goal truth',()=>{const x=temp();try{const t=x.repo.createTask({title:'A',instruction:'inspect'});assert.equal(t.taskContract.id,`TC-${t.id}`);assert.equal(t.requirementSources[0].text,'inspect');assert.equal('goal_state' in x.repo.state.tasks[0],false);x.db.close();const raw=JSON.parse(readFileSync(x.file,'utf8')).tasks[0];assert.ok(raw.task_contract);assert.ok(raw.requirement_sources);}finally{rmSync(x.dir,{recursive:true,force:true});}});

test('legacy tasks bootstrap additively at load boundary',()=>{const dir=mkdtempSync(join(tmpdir(),'task-contract-legacy-')),file=join(dir,'db.json');try{writeFileSync(file,JSON.stringify({counters:{task:1},tasks:[{id:'T-0001',title:'old',instruction:'original',status:'READY',ready_reason:'NEW',status_entered_at:'2026-08-13T00:00:00Z',created_at:'2026-08-13T00:00:00Z'}]}));const db=new JsonTaskDatabase(file),repo=new JsonTaskRepository(db),t=repo.getTask('T-0001');assert.equal(t.requirementSources[0].text,'original');assert.equal(t.taskContract.id,'TC-T-0001');assert.equal('goal_state' in repo.state.tasks[0],false);db.close();}finally{rmSync(dir,{recursive:true,force:true});}});

test('public Task API hides governed requirement state',()=>{const x=temp();try{const t=x.service.createTask({title:'A',instruction:'inspect'}),internal=x.repo.getTask(t.id);assert.ok(internal.taskContract);assert.equal('taskContract' in t,false);assert.equal('task_contract' in t,false);assert.equal('requirementSources' in t,false);assert.equal('requirement_sources' in t,false);}finally{x.db.close();rmSync(x.dir,{recursive:true,force:true});}});

test('bootstrap preserves existing immutable source instead of rebinding current text',()=>{const original=createInitialTaskContractState({taskId:'T-9',instruction:'original'});const s=bootstrapTaskContractState({id:'T-9',instruction:'changed',requirement_sources:original.requirement_sources,task_contract:original.task_contract});assert.equal(s.requirement_sources[0].text,'original');assert.equal(s.task_contract.requirement_refs[0].source_id,'REQ-T-9-0001');});
