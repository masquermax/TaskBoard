import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { Scheduler } from '../src/core/scheduler.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { TaskContractFidelityVerifier } from '../src/governance/task-contract-fidelity.js';
import { TaskStatus } from '../src/core/types.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

const rootDir=resolve('.');
const base={finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};
function work(id,projectAccess){return{id,title:id,goal:'perform one bounded project operation',expectedOutput:'return bounded result',stopCondition:'bounded result returned',projectAccess,networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']};}

function createRig({projectAccess='read'}={}){
  const dir=mkdtempSync(join(tmpdir(),'taskboard-authority-skeleton-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));
  const repository=new JsonTaskRepository(db);
  const taskService=new TaskService(repository);
  const project=taskService.createProject({name:'Project',path:dir});
  const events=[];let rootCalls=0;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      rootCalls+=1;events.push(subagentResults.length?'root:complete':'root:plan');onExecutionStarted?.();
      if(subagentResults.length)return{...base,kind:'complete',summary:'done',finalResult:'done'};
      return{...base,kind:'delegate',summary:'work',delegations:[work(projectAccess==='write'?'WU-WRITE':'WU-READ',projectAccess)]};
    },
    async runSubagent({delegation,onExecutionStarted}){events.push(`subagent:${delegation.id}`);onExecutionStarted?.();return{delegationId:delegation.id,result:'done',evidence:[],blocker:null};},
  };
  const modelRouter={async prepare(){},route(){return{};},release(){}};
  const rootRuntime=new RootRuntime({
    ...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter,
    subagentRuntime:{async run(task,delegation,options){return executor.runSubagent({task,delegation,...options});}},
    governanceCompiler:new GovernanceCompiler({rootDir}),
    taskContractFidelityVerifier:new TaskContractFidelityVerifier(),
  });
  const scheduler=new Scheduler({repository,taskService,rootRuntime,intervalMs:999999});
  const task=scheduler.createTask({title:projectAccess==='write'?'Write project':'Read project',instruction:projectAccess==='write'?'请修改项目中的目标文件，但不得联网。':'只读检查项目，不得修改文件，不得联网。',projectId:project.id});
  return{dir,db,repository,scheduler,task,events,counts:()=>({rootCalls}),close(){scheduler.stop();db.close();rmSync(dir,{recursive:true,force:true});}};
}

for(const scenario of [
  {name:'read-only work needs no promoted authority',projectAccess:'read',authorityKeys:[]},
  {name:'explicit human mutation deterministically grants projectWrite',projectAccess:'write',authorityKeys:['projectWrite']},
])test(scenario.name,async()=>{
  const rig=createRig({projectAccess:scenario.projectAccess});
  try{
    await rig.scheduler.tick();
    assert.equal(rig.repository.getTask(rig.task.id).status,TaskStatus.COMPLETED);
    assert.equal(rig.counts().rootCalls,2,'one plan turn + one stage synthesis turn');
    assert.deepEqual(rig.events,[`root:plan`,`subagent:${scenario.projectAccess==='write'?'WU-WRITE':'WU-READ'}`,'root:complete']);
    const authority=rig.repository.getTask(rig.task.id).taskContract.authority;
    assert.deepEqual(Object.keys(authority),scenario.authorityKeys);
    if(scenario.projectAccess==='write')assert.equal(authority.projectWrite.certification,'supported');
  }finally{rig.close();}
});
