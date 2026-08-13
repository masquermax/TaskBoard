import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultAuthoritySemanticCandidates } from '../src/governance/task-contract-fidelity.js';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';

const rootDir=resolve('.');

test('default authority candidates cover only missing governed semantics and preserve immutable requirement refs',()=>{
  const ref={source_id:'REQ-INITIAL',start:0,end:12};
  const task={id:'T-A',projectScopes:[{path:'/project'}],taskContract:{id:'TC-T-A',revision:1,requirementRefs:[ref],authority:{networkAccess:{value:true,certification:'unresolved',requirement_refs:[ref]}}}};
  const candidates=defaultAuthoritySemanticCandidates(task);
  assert.deepEqual(candidates.map(item=>item.key),['projectWrite']);
  assert.deepEqual(candidates[0].requirementRefs,[{sourceId:'REQ-INITIAL',start:0,end:12}]);
});

test('Task Core authority commit is additive, idempotent, and rejects semantic rewrite under the same key',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-authority-persist-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));const repo=new JsonTaskRepository(db);
  try{
    const task=repo.createTask({title:'authority',instruction:'请修改项目代码'});
    const item={value:true,certification:'supported',requirement_refs:[{source_id:'REQ-INITIAL',start:0,end:8}]};
    repo.commitTaskContractAuthority(task.id,{projectWrite:item});
    repo.commitTaskContractAuthority(task.id,{projectWrite:item});
    assert.deepEqual(repo.getTask(task.id).taskContract.authority.projectWrite,item);
    assert.throws(()=>repo.commitTaskContractAuthority(task.id,{projectWrite:{...item,certification:'unresolved'}}),/TASK_CONTRACT_AUTHORITY_CONFLICT:projectWrite/);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('initial authority certification runs once; persisted authority prevents Validator replay after a new Runtime session',async()=>{
  const instruction='请修改项目代码';
  const ref={source_id:'REQ-INITIAL',start:0,end:instruction.length};
  const base={id:'T-ONCE',title:'authority',instruction,projectScopes:[{path:'/project'}],attachments:[],references:[],requirementSources:[{id:'REQ-INITIAL',kind:'user_initial',text:instruction}],taskContract:{id:'TC-T-ONCE',revision:1,requirementRefs:[ref],authority:{},obligations:[],constraints:[]}};
  let calls=0;
  const verifier={async review({candidates}){calls+=1;return{checked:true,reviews:candidates.map(item=>({...item,certification:'supported',reason:'explicit'}))};}};
  const runtime=new RootRuntime({executor:{},modelRouter:{release(){}},subagentRuntime:{},governanceCompiler:new GovernanceCompiler({rootDir}),taskContractFidelityVerifier:verifier});
  let persisted=null;
  const session=runtime.createSession(base);
  const certified=await runtime.ensureTaskAuthority(base,session,{onTaskContractAuthority:value=>{persisted=value;},onProgress(){},onExecutionStarted(){}});
  assert.equal(calls,1);assert.equal(certified.taskContract.authority.projectWrite.certification,'supported');
  runtime.discardSession(base.id);
  const restored={...base,taskContract:{...base.taskContract,authority:persisted}};
  const restoredSession=runtime.createSession(restored);
  await runtime.ensureTaskAuthority(restored,restoredSession,{onTaskContractAuthority(){throw new Error('must not persist twice');},onProgress(){},onExecutionStarted(){}});
  assert.equal(calls,1,'persisted Authority facts make certification a no-op after session/restart recovery');
});
