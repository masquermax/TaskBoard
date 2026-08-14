import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { ModelRouter } from '../src/core/model-router.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { Scheduler } from '../src/core/scheduler.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { TaskStatus, WorkUnitStatus } from '../src/core/types.js';

const policySourceVerifier={enforce:({evidence})=>({evidence:Array.isArray(evidence)?evidence:[],actions:[],verifications:[]})};
const analysisBase={stageResult:null,progressCommits:[],finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[]};
const workerFact=id=>({
  delegationId:id,result:`${id} source checked`,
  evidence:[{id:`E-${id}`,strength:'direct',kind:'fact',sourceType:'reference',coverage:'component',statement:'ATTRIBUTE1 = person.getFdNo()',basis:'referenced result',locator:'Referenced completed Result',observation:'ATTRIBUTE1 = person.getFdNo()'}],
  claims:[{id:`C-${id}`,statement:'申请人工号写入 ATTRIBUTE1',level:'confirmed',evidenceIds:[`E-${id}`],scope:'single_system',coverage:'component',hops:[]}],
  gaps:[],recommendations:[],blocker:null,uncertainty:null,
});

function createRig(executor,semanticVerifier,{maxConcurrentSubagents=2}={}){
  const dir=mkdtempSync(join(tmpdir(),'taskboard-validator-resource-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));
  const repo=new JsonTaskRepository(db);
  const service=new TaskService(repo);
  const router=new ModelRouter();
  const compiler=new GovernanceCompiler({rootDir:resolve('.')});
  const structural=new AnalysisResultValidator();
  const validatorRuntime=new ValidatorRuntime({analysisValidator:structural,sourceTraceVerifier:policySourceVerifier,semanticVerifier});
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,governanceCompiler:compiler,validatorRuntime,maxConcurrentSubagents,retryDelaysMs:[0,0,0,0]});
  const scheduler=new Scheduler({repository:repo,taskService:service,rootRuntime:root,intervalMs:999999,retryDelaysMs:[0,0,0,0]});
  return{dir,db,repo,service,root,scheduler,close(){scheduler.stop();db.close();rmSync(dir,{recursive:true,force:true});}};
}

function makeRetryDue(x,taskId){
  const task=x.repo.getTask(taskId);
  if(task?.executionState?.retry){
    x.repo.touchTask(taskId,{executionState:{...task.executionState,retry:{...task.executionState.retry,nextAt:new Date(0).toISOString()}}});
  }
  const session=x.root.getSession(taskId);
  for(const unit of session?.currentStage?.workUnits||[])if(unit.status===WorkUnitStatus.WAITING_RESOURCE)unit.nextRetryAt=Date.now();
}

test('Validator capacity wait preserves a Root candidate and resumes certification without rerunning Root',async()=>{
  let rootCalls=0,validatorCalls=0;
  const executor={
    async runRoot({onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      return{...analysisBase,kind:'complete',summary:'candidate',evidence:[{id:'E-1',strength:'direct',kind:'fact',sourceType:'reference',coverage:'component',statement:'ATTRIBUTE1 = person.getFdNo()',basis:'referenced result',locator:'Referenced completed Result',observation:'ATTRIBUTE1 = person.getFdNo()'}],claims:[{id:'C-1',statement:'申请人工号写入 ATTRIBUTE1',level:'confirmed',evidenceIds:['E-1'],scope:'single_system',coverage:'component',hops:[]}]};
    },
    async runSubagent(){throw new Error('unused');},
  };
  const semanticVerifier={async review({decision,onExecutionStarted}){
    if(!(decision.claims||[]).length)return{checked:false,reviews:[],actions:[]};
    validatorCalls+=1;
    if(validatorCalls===1){const e=new Error('no available validator capacity');e.capacityUnavailable=true;throw e;}
    onExecutionStarted?.();
    return{checked:true,reviews:[{id:'C-1',verdict:'supported',reason:'source supports claim for test'}],actions:[]};
  }};
  const x=createRig(executor,semanticVerifier);
  try{
    const task=x.scheduler.createTask({title:'Root Validator 资源恢复',instruction:'根据项目分析结论'});
    await x.scheduler.tick();
    assert.equal(rootCalls,1);
    assert.equal(validatorCalls,1);
    assert.equal(x.service.getTask(task.id).status,TaskStatus.READY);
    assert.equal(x.root.getSession(task.id).pendingValidation?.phase,'validate');
    assert.equal(x.scheduler.getTaskActivity(task.id).current?.actor?.owner,'validator');

    makeRetryDue(x,task.id);
    await x.scheduler.tick();
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
    assert.equal(rootCalls,1,'temporary Validator capacity must not rerun an already-produced Root result');
    assert.equal(validatorCalls,2);
  }finally{x.close();}
});

test('Subagent result does not wait for semantic Validator; Root receives it while sibling execution continues',async()=>{
  let aWorkerCalls=0,bWorkerCalls=0,semanticCalls=0,bStarted=false,releaseB=null;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      onExecutionStarted?.();
      if(!subagentResults.length)return{...analysisBase,kind:'delegate',summary:'split',delegations:[{id:'a',title:'A核对',instruction:'A',goal:'A',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]},{id:'b',title:'B独立核对',instruction:'B',goal:'B',expectedOutput:'返回当前工作单的可验证局部结果',stopCondition:'当前目标完成或形成明确 Gap 后停止',skillId:null,dependsOn:[]}]};
      return{...analysisBase,kind:'complete',summary:'done',gaps:[{id:'G-F',question:'局部事实边界由 Root 收敛',reason:'Subagent results are local inputs',kind:'missing_fact',blocking:false,evidenceIds:[]}]};
    },
    async runSubagent({delegation,onExecutionStarted}){
      onExecutionStarted?.();
      if(delegation.id==='a'){aWorkerCalls+=1;return{delegationId:'a',result:'A local',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};}
      bWorkerCalls+=1;bStarted=true;return new Promise(resolveB=>{releaseB=()=>resolveB({delegationId:'b',result:'B local',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null});});
    },
  };
  const semanticVerifier={async review({decision}){if(!(decision?.claims||[]).length)return{checked:false,reviews:[],actions:[]};semanticCalls+=1;throw new Error('unexpected semantic claim');}};
  const x=createRig(executor,semanticVerifier,{maxConcurrentSubagents:1});
  try{
    const task=x.scheduler.createTask({title:'局部执行并行',instruction:'根据项目分析并行证据'});const ticking=x.scheduler.tick();
    for(let i=0;i<300&&!bStarted;i++)await new Promise(r=>setTimeout(r,5));
    assert.equal(bStarted,true,'free Subagent slot is reused while Root can consume A result');
    assert.equal(aWorkerCalls,1);assert.equal(bWorkerCalls,1);assert.equal(semanticCalls,0,'semantic Validator is not part of the Subagent execution path');
    releaseB();await ticking;assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});

test('Subagent execution is one bounded turn; semantic proof is deferred to Root candidate certification',async()=>{
  let subagentCalls=0,semanticCalls=0;
  const executor={async runSubagent({onExecutionStarted}){subagentCalls+=1;onExecutionStarted?.();return{delegationId:'w',result:'local',evidence:[],findings:[{id:'F-1',statement:'local finding',evidenceIds:[]}],discoveries:[],blocker:null,uncertainty:null};}};
  const semanticVerifier={async review(){semanticCalls+=1;return{checked:true,reviews:[],actions:[]};}};
  const structural=new AnalysisResultValidator();const runtime=new ValidatorRuntime({analysisValidator:structural,sourceTraceVerifier:policySourceVerifier,semanticVerifier});
  const subagent=new SubagentRuntime({executor,modelRouter:new ModelRouter()});
  const task={id:'T',title:'Subagent boundary',instruction:'分析',projectScopes:[],attachments:[]};
  const result=await subagent.run(task,{id:'w',title:'W',instruction:'W',goal:'W',expectedOutput:'返回局部证据',stopCondition:'局部证据完成后停止',skillId:null,dependsOn:[]},{policyContext:{taskMode:'analysis'}});
  assert.equal(result.delegationId,'w');assert.equal(subagentCalls,1);assert.equal(semanticCalls,0);assert.equal(result.findings[0].statement,'local finding');
});
