import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../src/core/model-router.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { WorkUnitStatus } from '../src/core/types.js';

function capabilityProvider(){
  return {
    snapshot(){return{
      discoveryLevel:'full',routingSafe:true,
      defaults:{model:'balanced-model'},
      modelSelection:{explicitPerTurn:true,maxPerTurn:1},
      models:[
        {id:'fast-model',displayName:'Fast',description:'Fast efficient model for routine lightweight work',reasoningEfforts:[{value:'low'},{value:'medium'}],priority:1},
        {id:'balanced-model',displayName:'Balanced',description:'Balanced general-purpose model for everyday work',reasoningEfforts:[{value:'low'},{value:'medium'},{value:'high'}],priority:1},
        {id:'frontier-model',displayName:'Frontier',description:'Frontier strongest capability for hardest complex reasoning',reasoningEfforts:[{value:'medium'},{value:'high'}],priority:1},
      ],
    };},
  };
}

function readOnlyWork(){
  return{
    id:'WU-READ',title:'读取 package.json 版本',goal:'只读取 package.json 的 version 字段。',
    expectedOutput:'返回 version 字符串和 package.json 定位。',stopCondition:'读取 package.json 的 version 后立即停止。',
    projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0'],
  };
}

function broadAuditWork(title='版本身份与 Codex Connection 全链路审计'){
  return{
    id:'WU-AUDIT',title,
    goal:'跨实现、配置、运行时与验证链核对当前行为，定位责任边界和仍未闭合的风险。',
    expectedOutput:'返回关键链路、直接源码证据、运行时边界和未验证风险。',
    stopCondition:'当关键链路均有来源证据且可以明确区分已验证、未验证和阻塞项时停止；不要扩大到无关功能。',
    projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0'],
  };
}

function callbacks(receipts=[]){return{onProgress(){},onStageCompleted(){},onProgressCommit(){},onCertifiedTurn(){},onTaskContractAuthority(){},onWorkReceipt(receipt){receipts.push(receipt);},onWorkReceiptsConsumed(){},onEffectAttempt(){},onEffectAttemptCleared(){},onExecutionStarted(){}};}

function runtimeWithBoundaryExecutor(work){
  const executor={async runSubagent({onExecutionStarted}){onExecutionStarted?.();const error=new Error('WORK_UNIT_EXECUTION_BOUNDARY: Work Unit reached its technical execution lease after a convergence steer.');error.executionBoundary=true;error.nonRetryable=true;throw error;}};
  const modelRouter={async prepare(){return null;},route(){return{};},release(){}};
  const subagentRuntime=new SubagentRuntime({executor,modelRouter});
  const root=new RootRuntime({executor,modelRouter,subagentRuntime,maxConcurrentSubagents:1});
  const task={id:'T-CONVERGENCE',title:'Convergence',instruction:'test',projectScopes:[{projectId:'P1',label:'P1',path:process.cwd(),source:'registry'}],attachments:[],references:[],taskContract:{authority:{}},analysisState:null,workReceipts:[]};
  const session=root.createSession(task);root.createStage(session,[work]);
  return{root,task,session};
}

test('broad repository audit is not downgraded to efficient solely because textual stop fields exist',()=>{
  const router=new ModelRouter({capabilityProvider:capabilityProvider()});
  const task={id:'T-ROUTE',title:'审计 TaskBoard',instruction:'核对当前实现。',projectScopes:[{path:process.cwd()}],attachments:[],references:[]};
  for(const title of [
    '版本身份与 Codex Connection 全链路审计',
    'Subagent 授权链与 Goal Completion 责任审计',
    'Evidence/SourceTrace 与发布风险审计',
  ]){
    const policy=router.route({role:'subagent',task,work:broadAuditWork(title)});
    assert.equal(policy.model,'balanced-model',title);
    assert.equal(policy.reasoningEffort,'medium',title);
    assert.equal(policy.routeReason,'minimum-sufficient-model-balanced',title);
  }
});

test('genuinely bounded project read still qualifies for efficient routing',()=>{
  const router=new ModelRouter({capabilityProvider:capabilityProvider()});
  const task={id:'T-ROUTE-SMALL',title:'读取版本',instruction:'读取 package.json version。',projectScopes:[{path:process.cwd()}],attachments:[],references:[]};
  const policy=router.route({role:'subagent',task,work:readOnlyWork()});
  assert.equal(policy.model,'fast-model');
  assert.equal(policy.reasoningEffort,'low');
  assert.equal(policy.routeReason,'minimum-sufficient-model-efficient');
});

test('side-effect-free execution boundary becomes a local non-convergence result for Root instead of user suspension',async()=>{
  const receipts=[];const {root,task,session}=runtimeWithBoundaryExecutor(readOnlyWork());
  const outcome=await root.runStage(task,session,callbacks(receipts));
  assert.equal(outcome.kind,'work_results_ready');
  assert.equal(outcome.results.length,1);
  assert.match(outcome.results[0].blocker,/WORK_UNIT_NON_CONVERGENT/);
  assert.deepEqual(outcome.results[0].evidence,[]);
  assert.deepEqual(outcome.results[0].findings,[]);
  assert.deepEqual(outcome.results[0].discoveries,[]);
  assert.equal(receipts.length,1);
  assert.match(receipts[0].result.blocker,/WORK_UNIT_NON_CONVERGENT/);
});

test('project-write execution boundary preserves effect recovery suspension',async()=>{
  const writeWork={...readOnlyWork(),id:'WU-WRITE',projectAccess:'write'};
  const {root,task,session}=runtimeWithBoundaryExecutor(writeWork);
  const outcome=await root.runStage(task,session,callbacks());
  assert.equal(outcome.kind,'suspended');
  const unit=session.currentStage.workUnits[0];
  assert.equal(unit.status,WorkUnitStatus.SUSPENDED);
  assert.equal(unit.effectRecoveryRequired,true);
});

test('network-enabled execution boundary preserves effect recovery suspension',async()=>{
  const networkWork={...readOnlyWork(),id:'WU-NETWORK',networkAccess:true};
  const {root,task,session}=runtimeWithBoundaryExecutor(networkWork);
  const outcome=await root.runStage(task,session,callbacks());
  assert.equal(outcome.kind,'suspended');
  const unit=session.currentStage.workUnits[0];
  assert.equal(unit.status,WorkUnitStatus.SUSPENDED);
  assert.equal(unit.effectRecoveryRequired,true);
});

test('a Work Unit with a blocked prerequisite never invokes the Subagent executor',async()=>{
  let executorCalls=0;
  const executor={async runSubagent(){executorCalls+=1;throw new Error('dependent Work must not execute');}};
  const modelRouter={async prepare(){throw new Error('blocked dependency must be rejected before model preparation');},route(){return{};},release(){}};
  const runtime=new SubagentRuntime({executor,modelRouter});
  const dependent={
    ...readOnlyWork(),id:'WU-DEPENDENT',dependsOn:['WU-AUDIT'],
    dependencyResults:[{
      id:'WU-AUDIT',title:'Audit',
      result:{blocker:'WORK_UNIT_NON_CONVERGENT: prerequisite did not converge'},
    }],
  };
  const result=await runtime.run({id:'T-DEPENDENCY',projectScopes:[],attachments:[],references:[]},dependent);
  assert.equal(executorCalls,0);
  assert.match(result.blocker,/WORK_UNIT_DEPENDENCY_UNSATISFIED/);
  assert.deepEqual(result.evidence,[]);
  assert.deepEqual(result.findings,[]);
  assert.deepEqual(result.discoveries,[]);
});