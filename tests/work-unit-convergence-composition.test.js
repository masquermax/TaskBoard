import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { Scheduler } from '../src/core/scheduler.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { TaskStatus } from '../src/core/types.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

const rootDir=resolve('.');
const decisionBase={stageResult:null,progressCommits:[],finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[]};

function broadAudit(id='WU-AUDIT'){
  return{
    id,
    title:'版本身份与 Codex Connection 全链路审计',
    goal:'跨实现、配置、运行时与验证链核对版本身份和 Codex Connection 行为。',
    expectedOutput:'返回关键链路、直接源码证据、运行时边界和未验证风险。',
    stopCondition:'当关键链路均有来源证据且可以明确区分已验证、未验证和阻塞项时停止；不要扩大到无关功能。',
    projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0'],
  };
}

function oldDependentAudit(){
  return{
    id:'WU-OLD-DEPENDENT',
    title:'基于全链路审计结果核对发布身份',
    goal:'只基于 WU-AUDIT 的完整结果核对发布身份。',
    expectedOutput:'返回依赖全链路审计结果的发布身份判断。',
    stopCondition:'完成对 WU-AUDIT expectedOutput 的消费后立即停止。',
    projectAccess:'read',networkAccess:false,skillId:null,dependsOn:['WU-AUDIT'],inputRefs:['project:0'],
  };
}

function narrowRead(){
  return{
    id:'WU-VERSION',
    title:'读取 package.json 版本',
    goal:'只读取 package.json 的 version 字段。',
    expectedOutput:'返回 version 字符串和 package.json 定位。',
    stopCondition:'读取 package.json 的 version 后立即停止。',
    projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0'],
  };
}

function narrowDependent(){
  return{
    id:'WU-VERSION-CHECK',
    title:'基于 version 结果确认版本身份',
    goal:'只消费 WU-VERSION 返回的 version 结果并形成版本身份判断。',
    expectedOutput:'返回基于 WU-VERSION 的版本身份判断。',
    stopCondition:'确认 WU-VERSION 的 version 后立即停止。',
    projectAccess:'read',networkAccess:false,skillId:null,dependsOn:['WU-VERSION'],inputRefs:['project:0'],
  };
}

function completeDecision(){
  return{...decisionBase,kind:'complete',summary:'bounded replanning complete',finalResult:'bounded replanning complete'};
}

test('side-effect-free execution boundary returns control to Root, blocks dependent execution, rejects blind replay, and completes through narrower Work',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-work-convergence-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));
  const repository=new JsonTaskRepository(db);
  const taskService=new TaskService(repository);
  const project=taskService.createProject({name:'Project',path:dir});
  const events=[];
  const rootInputs=[];
  let broadExecutions=0;
  let oldDependentExecutions=0;
  let narrowExecutions=0;
  let narrowDependentExecutions=0;

  const executor={
    async runRoot({subagentResults,planningFeedback,onExecutionStarted}){
      onExecutionStarted?.();
      rootInputs.push((subagentResults||[]).map(item=>({id:item.delegationId,blocker:item.blocker||null,result:item.result||''})));
      if(planningFeedback?.length){
        events.push('root:narrow-after-replay-rejection');
        assert.match(planningFeedback.join(' | '),/语义重复/);
        return{...decisionBase,kind:'delegate',summary:'replace broad Work with bounded dependency chain',delegations:[narrowRead(),narrowDependent()]};
      }
      if((subagentResults||[]).some(item=>item.delegationId==='WU-VERSION-CHECK')){
        events.push('root:complete');
        return completeDecision();
      }
      if((subagentResults||[]).some(item=>item.delegationId==='WU-VERSION')){
        events.push('root:wait-for-narrow-dependent');
        return completeDecision();
      }
      if((subagentResults||[]).some(item=>/WORK_UNIT_NON_CONVERGENT/.test(item.blocker||''))){
        events.push('root:blind-replay-attempt');
        return{...decisionBase,kind:'delegate',summary:'incorrectly retry the same semantic Work',delegations:[broadAudit('WU-AUDIT-REPLAY')]};
      }
      events.push('root:broad');
      return{...decisionBase,kind:'delegate',summary:'start broad audit with one true dependent',delegations:[broadAudit(),oldDependentAudit()]};
    },
    async runSubagent({delegation,onExecutionStarted}){
      if(delegation.id==='WU-AUDIT'){
        broadExecutions+=1;
        onExecutionStarted?.();
        events.push('subagent:broad-boundary');
        const error=new Error('WORK_UNIT_EXECUTION_BOUNDARY: Work Unit reached its technical execution lease after a convergence steer.');
        error.executionBoundary=true;
        error.nonRetryable=true;
        throw error;
      }
      if(delegation.id==='WU-OLD-DEPENDENT'){
        oldDependentExecutions+=1;
        throw new Error('dependent Work must not execute when WU-AUDIT is blocked');
      }
      if(delegation.id==='WU-VERSION'){
        narrowExecutions+=1;
        onExecutionStarted?.();
        events.push('subagent:narrow-complete');
        return{delegationId:delegation.id,result:'package.json version is 0.9.2',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};
      }
      if(delegation.id==='WU-VERSION-CHECK'){
        narrowDependentExecutions+=1;
        onExecutionStarted?.();
        events.push('subagent:narrow-dependent-complete');
        await new Promise(resolveWait=>setTimeout(resolveWait,20));
        return{delegationId:delegation.id,result:'version identity confirmed from WU-VERSION',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};
      }
      throw new Error(`unexpected Subagent Work: ${delegation.id}`);
    },
  };
  const modelRouter={async prepare(){return null;},route(){return{};},release(){}};
  const subagentRuntime=new SubagentRuntime({executor,modelRouter});
  const rootRuntime=new RootRuntime({
    ...successfulCompletionDependenciesForControlFlowTest(),
    executor,modelRouter,subagentRuntime,
    governanceCompiler:new GovernanceCompiler({rootDir}),
    retryDelaysMs:[1_000,1_000,1_000,1_000],
  });
  const scheduler=new Scheduler({repository,taskService,rootRuntime,intervalMs:999_999,retryDelaysMs:[1_000,1_000,1_000,1_000]});
  const task=scheduler.createTask({title:'审计 TaskBoard 关键链路',instruction:'先核对项目；如果工作边界过大，必须缩小后继续。',projectId:project.id});

  try{
    await scheduler.tick();
    const completed=repository.getTask(task.id);
    assert.equal(completed.status,TaskStatus.COMPLETED);
    assert.equal(broadExecutions,1,'the same broad semantic Work must never reach Subagent twice');
    assert.equal(oldDependentExecutions,0,'a dependent whose prerequisite is blocked must not invoke the executor');
    assert.equal(narrowExecutions,1);
    assert.equal(narrowDependentExecutions,1);
    assert.ok(events.includes('root:broad'));
    assert.ok(events.includes('subagent:broad-boundary'));
    assert.ok(events.includes('root:blind-replay-attempt'));
    assert.ok(events.includes('root:narrow-after-replay-rejection'));
    assert.ok(events.includes('subagent:narrow-complete'));
    assert.ok(events.includes('subagent:narrow-dependent-complete'));
    assert.equal(events.at(-1),'root:complete');
    assert.ok(rootInputs.some(batch=>batch.some(item=>/WORK_UNIT_NON_CONVERGENT/.test(item.blocker||''))),'Root must directly observe the bounded non-convergence result');
    assert.ok(rootInputs.some(batch=>batch.some(item=>/WORK_UNIT_DEPENDENCY_UNSATISFIED/.test(item.blocker||''))),'Root must observe the affected dependency radius without executing it');
    const receipts=completed.workReceipts||[];
    const boundaryReceipt=receipts.find(receipt=>receipt.id==='WU-AUDIT');
    assert.ok(boundaryReceipt,'technical non-convergence must be durable across Runtime recovery');
    assert.match(boundaryReceipt.result?.blocker||'',/WORK_UNIT_NON_CONVERGENT/);
    const blockedDependentReceipt=receipts.find(receipt=>receipt.id==='WU-OLD-DEPENDENT');
    assert.ok(blockedDependentReceipt,'the dependency-blocked Work occurrence must be durable without pretending it executed');
    assert.match(blockedDependentReceipt.result?.blocker||'',/WORK_UNIT_DEPENDENCY_UNSATISFIED/);
    assert.equal(blockedDependentReceipt.started_at??null,null,'blocked dependent must remain explicitly unstarted');
    assert.ok(receipts.find(receipt=>receipt.id==='WU-VERSION'),'the narrower replacement must have its own durable receipt');
    assert.ok(receipts.find(receipt=>receipt.id==='WU-VERSION-CHECK'),'the valid replacement dependency must execute after its prerequisite succeeds');
  }finally{
    scheduler.stop();
    db.close();
    rmSync(dir,{recursive:true,force:true});
  }
});