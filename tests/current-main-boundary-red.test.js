import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { Scheduler } from '../src/core/scheduler.js';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { TaskStatus, ReadyReason } from '../src/core/types.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

const rootDir=resolve('.');

function controlDecision(overrides={}) {
  return {
    kind:'complete',
    summary:'',
    stageResult:null,
    finalResult:null,
    resultMode:'execution',
    evidence:[],
    claims:[],
    gaps:[],
    recommendations:[],
    steps:[],
    gateway:null,
    gapResolutions:[],
    delegations:[],
    ...overrides,
  };
}

function supportedAuthority(value, ref) {
  return { value, certification:'supported', requirement_refs:[ref] };
}

function writeAuthorizedTask({id='T-EFFECT',projectPath}) {
  const instruction='修改当前项目文件并返回完成结果';
  const ref={source_id:'REQ-INITIAL',start:0,end:instruction.length};
  return {
    id,
    title:'写入任务',
    instruction,
    status:TaskStatus.READY,
    ready_reason:ReadyReason.NEW,
    projectScopes:[{source:'temporary',projectId:null,label:'测试项目',path:projectPath}],
    attachments:[],
    references:[],
    requirementSources:[{id:'REQ-INITIAL',kind:'user_initial',text:instruction}],
    taskContract:{
      id:`TC-${id}`,
      revision:1,
      requirementRefs:[ref],
      authority:{projectWrite:supportedAuthority(true,ref)},
      obligations:[],
      constraints:[],
    },
    analysisState:null,
    workReceipts:[],
  };
}

test('D-023: transport loss after a write effect must not blindly replay the same mutation-capable Work Unit', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-no-blind-replay-'));
  const project=join(dir,'project');mkdirSync(project);
  let rootCalls=0;
  let workCalls=0;
  let realityMutations=0;
  const executor={
    async runRoot(){
      rootCalls+=1;
      if(rootCalls===1){
        return controlDecision({
          kind:'delegate',
          summary:'执行写入',
          delegations:[{
            id:'WU-WRITE',title:'写入项目',goal:'修改项目',expectedOutput:'项目已按要求修改',stopCondition:'完成目标后停止',
            projectAccess:'write',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0'],
          }],
        });
      }
      return controlDecision({kind:'complete',summary:'完成',stageResult:'完成',finalResult:'完成'});
    },
    async runSubagent({onExecutionStarted}){
      workCalls+=1;
      onExecutionStarted?.();
      // Simulate the dangerous ordering observed in a real effect-capable turn:
      // reality changes first, then TaskBoard loses the result/transport.
      realityMutations+=1;
      throw new Error('stream disconnected before completion: error sending request for url');
    },
  };
  const router=new ModelRouter();
  const subagentRuntime=new SubagentRuntime({executor,modelRouter:router});
  const rootRuntime=new RootRuntime({
    ...successfulCompletionDependenciesForControlFlowTest(),
    executor,
    modelRouter:router,
    subagentRuntime,
    governanceCompiler:new GovernanceCompiler({rootDir}),
    maxConcurrentSubagents:1,
    retryDelaysMs:[0,0,0,0],
  });
  try{
    const outcome=await rootRuntime.execute(writeAuthorizedTask({projectPath:project}));
    assert.equal(outcome.kind,'suspended','unknown effect outcome may suspend/wait, but must not be treated as safe blind replay');
    assert.equal(workCalls,1,'transport loss after possible mutation must not automatically re-actuate the same write Work Unit');
    assert.equal(realityMutations,1,'the external mutation must occur at most once without reality reconciliation');
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});

test('D-023: stale effect-capable RUNNING recovery must not authorize fresh actuation before reality is reconciled', async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-stale-effect-recovery-'));
  const project=join(dir,'project');mkdirSync(project);
  const db=new JsonTaskDatabase(join(dir,'db.json'));
  const repo=new JsonTaskRepository(db);
  const service=new TaskService(repo);
  let freshActuations=0;
  const rootRuntime={
    executor:{readiness(){return{ready:true,preparing:false,reason:null,message:null};}},
    async execute(_task,{onExecutionStarted}={}){
      freshActuations+=1;
      onExecutionStarted?.({role:'root'});
      return {kind:'waiting_resource',retryAt:Date.now()+60_000,snapshot:null,reason:'test stop'};
    },
    isQuiescent(){return true;},
    snapshot(){return null;},
    discardSession(){},
    cleanupTaskWorkspace(){return false;},
  };
  const scheduler=new Scheduler({repository:repo,taskService:service,rootRuntime,intervalMs:999999});
  try{
    const created=repo.createTask({title:'stale write',instruction:'修改当前项目',temporaryProjectPath:project});
    const initial=repo.getTask(created.id);
    const ref=initial.taskContract.requirementRefs[0];
    repo.commitTaskContractAuthority(created.id,{projectWrite:supportedAuthority(true,ref)});
    const task=repo.getTask(created.id);
    const workUnit={
      id:'WU-WRITE',title:'写入',goal:'修改项目',expectedOutput:'项目已修改',stopCondition:'完成修改后停止',
      projectAccess:'write',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0'],
    };
    const grant=new GovernanceCompiler({rootDir}).compileForRole(task,'subagent',{workUnit}).authorizedGrant;
    assert.equal(grant.projectAccess,'write','fixture must prove the stale effect-capable Work Unit came through the real D-017 Authority chain');
    assert.deepEqual(grant.selectedInputRefs,['project:0']);

    repo.transitionTask(task.id,TaskStatus.RUNNING,{
      executionState:{
        snapshot:{
          taskId:task.id,
          stage:{id:'stage-1',workUnits:[{
            ...workUnit,
            projectAccess:grant.projectAccess,
            networkAccess:grant.networkAccess,
            inputRefs:grant.selectedInputRefs,
            status:'RUNNING',owner:'subagent',
          }]},
        },
      },
    });

    assert.equal(scheduler.recoverStaleRunningTasks(),1);
    await scheduler.tick();
    assert.equal(freshActuations,0,
      'a stale effect-capable execution with unknown outcome/liveness must not be automatically re-admitted before a stable recovery boundary');
  }finally{
    scheduler.stop();
    db.close();
    rmSync(dir,{recursive:true,force:true});
  }
});

test('D-017/D-006: Subagent Evidence source-trace semantics presented to Root must not depend on inferred taskMode', async()=>{
  let traceCalls=0;
  const sourceTraceVerifier={
    enforce({evidence}){
      traceCalls+=1;
      return {
        evidence:(evidence||[]).map(item=>({...item,strength:'indirect'})),
        actions:[],
        verifications:[],
      };
    },
  };
  const executor={
    async runSubagent(){
      return {
        delegationId:'WU-TRACE',
        result:'done',
        evidence:[{
          id:'E-TRACE',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',
          statement:'事实',basis:'src/a.js#L1',locator:'src/a.js#L1',observation:'事实',
        }],
        findings:[{id:'F-1',statement:'事实',evidenceIds:['E-TRACE']}],
        discoveries:[],blocker:null,uncertainty:null,
      };
    },
  };
  const modelRouter={async prepare(){},route(){return{};}};
  const runtime=new SubagentRuntime({executor,modelRouter,sourceTraceVerifier});
  const task={id:'T-TRACE',title:'trace',instruction:'trace',projectScopes:[],attachments:[],references:[]};
  const delegation={
    id:'WU-TRACE',title:'trace',goal:'trace',expectedOutput:'evidence',stopCondition:'done',
    projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[],
  };

  const analysis=await runtime.run(task,delegation,{policyContext:{taskMode:'analysis'}});
  const execution=await runtime.run(task,delegation,{policyContext:{taskMode:'execution'}});

  assert.equal(traceCalls,2,'SourceTrace is an Evidence boundary, not a taskMode-controlled Runtime semantic');
  assert.equal(analysis.evidence[0].strength,'indirect');
  assert.equal(execution.evidence[0].strength,'indirect');
  assert.deepEqual(execution.evidence,analysis.evidence,'Root must receive the same pre-certification Evidence semantics in both modes');
});
