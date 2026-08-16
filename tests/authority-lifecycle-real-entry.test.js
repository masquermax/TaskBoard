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
import { TaskStatus } from '../src/core/types.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

const rootDir=resolve('.');
const decisionBase={stageResult:null,progressCommits:[],finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[]};

function work(id,projectAccess='read',overrides={}){
  return{
    id,title:`${id} bounded work`,goal:'perform exactly one bounded project operation',
    expectedOutput:'return the bounded result',stopCondition:'the bounded result is returned',
    projectAccess,networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0'],
    ...overrides,
  };
}
function completeDecision(){
  return{...decisionBase,kind:'complete',summary:'bounded flow complete',finalResult:'bounded flow complete'};
}

function createRig({projectAccess='read',capacityWait=false,invalidDelegations=null}={}){
  const dir=mkdtempSync(join(tmpdir(),'taskboard-root-first-authority-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));
  const repository=new JsonTaskRepository(db);
  const taskService=new TaskService(repository);
  const project=taskService.createProject({name:'Project',path:dir});
  const events=[];
  const grants=[];
  const candidateAttempts=[];
  let planRootCalls=0;
  let completionRootCalls=0;
  const executor={
    async runRoot({subagentResults,planningFeedback,onExecutionStarted}){
      if(subagentResults.length){
        completionRootCalls+=1;
        events.push('root:complete');
        onExecutionStarted?.();
        return completeDecision();
      }
      planRootCalls+=1;
      events.push('root:plan');
      onExecutionStarted?.();
      if(invalidDelegations&&planningFeedback?.length)return completeDecision();
      return{
        ...decisionBase,kind:'delegate',summary:'one bounded delegation',
        delegations:invalidDelegations||[work(projectAccess==='write'?'WU-WRITE':'WU-READ',projectAccess)],
      };
    },
  };
  const taskContractFidelityVerifier={
    async review({candidates,onExecutionStarted}){
      candidateAttempts.push(candidates.map(candidate=>({id:candidate.id,key:candidate.key,value:candidate.value,requirementRefs:candidate.requirementRefs})));
      if(capacityWait&&candidateAttempts.length===1){
        const error=new Error('no available validator capacity');
        error.capacityUnavailable=true;
        throw error;
      }
      events.push(`authority-validator:${candidates.map(candidate=>candidate.key).join(',')}`);
      onExecutionStarted?.();
      return{checked:true,reviews:candidates.map(candidate=>({...candidate,certification:'supported',reason:'explicit requirement'}))};
    },
  };
  const modelRouter={async prepare(){},route(){return{};},release(){}};
  const subagentRuntime={
    async run(_task,delegation,{policyContext,onExecutionStarted}){
      events.push(`subagent:${delegation.id}`);
      grants.push(policyContext?.authorizedGrant||null);
      onExecutionStarted?.();
      return{delegationId:delegation.id,result:'bounded work complete',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};
    },
  };
  const rootRuntime=new RootRuntime({
    ...successfulCompletionDependenciesForControlFlowTest(),
    executor,modelRouter,subagentRuntime,
    governanceCompiler:new GovernanceCompiler({rootDir}),
    taskContractFidelityVerifier,
    retryDelaysMs:[1_000,1_000,1_000,1_000],
  });
  const scheduler=new Scheduler({repository,taskService,rootRuntime,intervalMs:999_999,retryDelaysMs:[1_000,1_000,1_000,1_000]});
  const task=scheduler.createTask({
    title:projectAccess==='write'?'Write exactly one project file':'Read the project only',
    instruction:projectAccess==='write'?'修改项目中的目标文件，但不得联网。':'只读检查项目，不得修改文件，不得联网。',
    projectId:project.id,
  });
  return{
    dir,db,repository,taskService,rootRuntime,scheduler,task,events,grants,candidateAttempts,
    counts:()=>({planRootCalls,completionRootCalls}),
    close(){scheduler.stop();db.close();rmSync(dir,{recursive:true,force:true});},
  };
}

function makeRetryDue(rig){
  const current=rig.repository.getTask(rig.task.id);
  rig.repository.touchTask(rig.task.id,{
    executionState:{...current.executionState,retry:{...current.executionState.retry,nextAt:new Date(0).toISOString()}},
  });
}

for(const scenario of [
  {name:'read-only Work reaches Subagent without manufacturing Authority',projectAccess:'read',candidateKeys:[],grant:'read'},
  {name:'write Work promotes only projectWrite after Root and realizes the exact grant',projectAccess:'write',candidateKeys:['projectWrite'],grant:'write'},
]){
  test(scenario.name,async()=>{
    const rig=createRig({projectAccess:scenario.projectAccess});
    try{
      await rig.scheduler.tick();
      assert.equal(rig.repository.getTask(rig.task.id).status,TaskStatus.COMPLETED);
      assert.deepEqual(rig.candidateAttempts.flat().map(item=>item.key),scenario.candidateKeys);
      assert.equal(rig.counts().planRootCalls,1);
      assert.equal(rig.counts().completionRootCalls,1);
      const expected=scenario.projectAccess==='read'
        ?['root:plan','subagent:WU-READ','root:complete']
        :['root:plan','authority-validator:projectWrite','subagent:WU-WRITE','root:complete'];
      assert.deepEqual(rig.events,expected);
      assert.deepEqual(rig.grants,[{
        role:'subagent',projectAccess:scenario.grant,networkAccess:false,inputRefs:['project:0'],
        sourceAccess:'selected',environmentAccess:'default',
      }]);
      const authority=rig.repository.getTask(rig.task.id).taskContract.authority;
      if(scenario.projectAccess==='read')assert.deepEqual(authority,{});
      else{
        assert.deepEqual(Object.keys(authority),['projectWrite']);
        assert.equal(authority.projectWrite.value,true);
        assert.equal(authority.projectWrite.certification,'supported');
      }
    }finally{rig.close();}
  });
}

test('Validator capacity wait preserves one accepted write plan without Root replay or premature Authority persistence',async()=>{
  const rig=createRig({projectAccess:'write',capacityWait:true});
  try{
    await rig.scheduler.tick();
    assert.equal(rig.counts().planRootCalls,1,'Root must author the concrete Work demand before Authority Validator waits');
    assert.equal(rig.repository.getTask(rig.task.id).status,TaskStatus.READY);
    assert.equal(rig.rootRuntime.getSession(rig.task.id).pendingValidation?.phase,'authority');
    assert.deepEqual(rig.repository.getTask(rig.task.id).taskContract.authority,{},'capacity shortage is not a semantic verdict');
    assert.deepEqual(rig.candidateAttempts[0].map(item=>item.key),['projectWrite']);

    makeRetryDue(rig);
    await rig.scheduler.tick();

    assert.equal(rig.repository.getTask(rig.task.id).status,TaskStatus.COMPLETED);
    assert.equal(rig.counts().planRootCalls,1,'the retained accepted plan must resume without asking Root again');
    assert.equal(rig.candidateAttempts.length,2);
    assert.deepEqual(rig.candidateAttempts[1],rig.candidateAttempts[0],'the exact semantic candidate identity must survive capacity resume');
    assert.deepEqual(rig.events,['root:plan','authority-validator:projectWrite','subagent:WU-WRITE','root:complete']);
    assert.equal(rig.repository.getTask(rig.task.id).taskContract.authority.projectWrite.certification,'supported');
    assert.equal(rig.grants[0].projectAccess,'write');
    assert.equal(rig.grants[0].networkAccess,false);
  }finally{rig.close();}
});

for(const scenario of [
  {
    name:'semantic duplicate',
    delegations:[
      work('WU-A','write',{title:'same',goal:'same',expectedOutput:'same',stopCondition:'same'}),
      work('WU-B','write',{title:'same',goal:'same',expectedOutput:'same',stopCondition:'same'}),
    ],
  },
  {
    name:'unknown Skill',
    delegations:[work('WU-UNKNOWN-SKILL','write',{skillId:'missing-skill'})],
  },
]){
  test(`${scenario.name} rejection cannot create durable Authority`,async()=>{
    const rig=createRig({projectAccess:'write',invalidDelegations:scenario.delegations});
    try{
      await rig.scheduler.tick();
      assert.equal(rig.repository.getTask(rig.task.id).status,TaskStatus.COMPLETED);
      assert.equal(rig.candidateAttempts.length,0,'all authority-independent plan checks must finish before semantic promotion');
      assert.deepEqual(rig.repository.getTask(rig.task.id).taskContract.authority,{});
      assert.equal(rig.grants.length,0);
      assert.equal(rig.counts().planRootCalls,2,'bounded planning feedback returns control to Root without admitting invalid Work');
    }finally{rig.close();}
  });
}
