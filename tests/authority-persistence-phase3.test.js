import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { authoritySemanticCandidatesForWork } from '../src/governance/task-contract-fidelity.js';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { RootRuntime } from '../src/core/root-runtime.js';


test('work authority candidates cover only demanded missing semantics and preserve immutable requirement refs',()=>{
  const ref={source_id:'REQ-INITIAL',start:0,end:12},task={id:'T-A',projectScopes:[{path:'/project'}],taskContract:{id:'TC-T-A',revision:1,requirementRefs:[ref],authority:{networkAccess:{value:true,certification:'unresolved',requirement_refs:[ref]}}}};
  assert.deepEqual(authoritySemanticCandidatesForWork(task,[{projectAccess:'read',networkAccess:false}]),[]);
  const candidates=authoritySemanticCandidatesForWork(task,[{projectAccess:'write',networkAccess:false}]);assert.deepEqual(candidates.map(item=>item.key),['projectWrite']);assert.deepEqual(candidates[0].requirementRefs,[{sourceId:'REQ-INITIAL',start:0,end:12}]);
});

test('Task Core authority commit is additive, idempotent, and rejects semantic rewrite under the same key',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-authority-persist-')),db=new JsonTaskDatabase(join(dir,'db.json')),repo=new JsonTaskRepository(db);
  try{const task=repo.createTask({title:'authority',instruction:'请修改项目代码'}),item={value:true,certification:'supported',requirement_refs:[{source_id:'REQ-INITIAL',start:0,end:8}]};repo.commitTaskContractAuthority(task.id,{projectWrite:item});repo.commitTaskContractAuthority(task.id,{projectWrite:item});assert.deepEqual(repo.getTask(task.id).taskContract.authority.projectWrite,item);assert.throws(()=>repo.commitTaskContractAuthority(task.id,{projectWrite:{...item,certification:'unresolved'}}),/TASK_CONTRACT_AUTHORITY_CONFLICT:projectWrite/);}finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('persisted supported authority makes later fidelity certification a no-op',async()=>{
  const instruction='请修改项目代码',ref={source_id:'REQ-INITIAL',start:0,end:instruction.length},base={id:'T-ONCE',title:'authority',instruction,projectScopes:[{path:'/project'}],attachments:[],references:[],requirementSources:[{id:'REQ-INITIAL',text:instruction}],taskContract:{id:'TC-T-ONCE',revision:1,requirementRefs:[ref],authority:{},obligations:[],constraints:[]}};
  let calls=0;const verifier={async review({candidates}){calls+=1;return{checked:true,reviews:candidates.map(item=>({...item,certification:'supported',reason:'explicit'}))};}},runtime=new RootRuntime({executor:{},modelRouter:{release(){}},subagentRuntime:{},taskContractFidelityVerifier:verifier}),workUnits=[{projectAccess:'write',networkAccess:false}],callbacks={onTaskContractAuthority:value=>{callbacks.persisted=value;}};
  const certified=await runtime.certifyWorkAuthority(base,callbacks,workUnits);assert.equal(calls,1);assert.equal(certified.taskContract.authority.projectWrite.certification,'supported');
  const restored={...base,taskContract:{...base.taskContract,authority:callbacks.persisted}};
  const second=await runtime.certifyWorkAuthority(restored,{onTaskContractAuthority(){throw new Error('must not persist twice');}},workUnits);assert.equal(calls,1);assert.equal(second.taskContract.authority.projectWrite.certification,'supported');
});
