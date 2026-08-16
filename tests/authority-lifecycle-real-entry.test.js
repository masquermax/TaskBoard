import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';

const rootDir=resolve('.');

function realReadOnlyTask(){
  const dir=mkdtempSync(join(tmpdir(),'taskboard-authority-lifecycle-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));
  const repo=new JsonTaskRepository(db);
  const project=repo.createProject({name:'Project',path:join(dir,'project')});
  const task=repo.createTask({
    title:'只读审计',
    instruction:'请审计当前项目，不得修改任何文件，不得联网。',
    projectId:project.id,
  });
  return{dir,db,task};
}

test('a real newly-created Task reaches Root before any Authority fidelity Validator',async()=>{
  const {dir,db,task}=realReadOnlyTask();
  const calls=[];
  const stop=new Error('STOP_AFTER_FIRST_ROOT');
  const executor={
    async runRoot({onExecutionStarted}){
      calls.push('root');
      onExecutionStarted?.();
      throw stop;
    },
  };
  const taskContractFidelityVerifier={
    async review({candidates}){
      calls.push('authority-validator');
      return{checked:true,reviews:candidates.map(candidate=>({...candidate,certification:'unresolved',reason:'not established'}))};
    },
  };
  const modelRouter={async prepare(){},route(){return{};},release(){}};
  const runtime=new RootRuntime({
    executor,
    modelRouter,
    subagentRuntime:{},
    governanceCompiler:new GovernanceCompiler({rootDir}),
    taskContractFidelityVerifier,
  });
  try{
    await assert.rejects(()=>runtime.execute(task),error=>error===stop);
    assert.equal(calls[0],'root','new Task semantics must be interpreted by Root before Validator can certify a concrete promotion');
    assert.deepEqual(calls,['root'],'read-only/no-network Task must not manufacture write/network Authority candidates');
  }finally{
    db.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
