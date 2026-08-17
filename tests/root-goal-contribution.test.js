import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

const baseDecision={
  stageResult:null,
  finalResult:null,
  resultMode:'execution',
  evidence:[],
  claims:[],
  recommendations:[],
  steps:[],
  gateway:null,
  gapResolutions:[],
  delegations:[],
};

function targetGap(){
  return{
    id:'G-TARGET',
    question:'What exact runtime fact is still missing to satisfy the current governed goal?',
    reason:'The goal cannot be advanced reliably until this specific runtime fact is known.',
    kind:'missing_fact',
    blocking:false,
    evidenceIds:[],
  };
}

function unrelatedWork(){
  return{
    id:'WU-UNBOUND',
    title:'Inventory unrelated repository metadata',
    goal:'Read unrelated repository metadata that does not answer G-TARGET.',
    expectedOutput:'Return the unrelated metadata.',
    stopCondition:'Stop after returning that metadata.',
    projectAccess:'none',
    networkAccess:false,
    skillId:null,
    dependsOn:[],
    inputRefs:[],
  };
}

test('new Work without a machine-checkable governed contribution is rejected before Executor admission',async()=>{
  let rootCalls=0;
  let subagentCalls=0;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      rootCalls+=1;
      onExecutionStarted?.();
      if((subagentResults||[]).length){
        return{...baseDecision,kind:'complete',summary:'unrelated work returned, but governed deficit is unchanged',finalResult:'done',gaps:[]};
      }
      return{
        ...baseDecision,
        kind:'delegate',
        summary:'issue a structurally valid but goal-unbound Work Unit',
        gaps:[targetGap()],
        delegations:[unrelatedWork()],
      };
    },
    async runSubagent({delegation,onExecutionStarted}){
      subagentCalls+=1;
      onExecutionStarted?.();
      return{
        delegationId:delegation.id,
        result:'unrelated metadata',
        evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null,
      };
    },
  };
  const modelRouter=new ModelRouter();
  const subagentRuntime=new SubagentRuntime({executor,modelRouter});
  const runtime=new RootRuntime({
    ...successfulCompletionDependenciesForControlFlowTest(),
    executor,modelRouter,subagentRuntime,
  });
  const task={
    id:'T-GOAL-CONTRIBUTION',
    title:'Close the governed runtime deficit',
    instruction:'Resolve the current governed runtime deficit with the minimum necessary work.',
    projectScopes:[],attachments:[],references:[],analysisState:null,workReceipts:[],taskContract:{authority:{}},
  };

  await assert.rejects(
    runtime.execute(task),
    /ROOT_WORK_WITHOUT_GOVERNED_CONTRIBUTION/,
    'Root must not be able to turn narrative non-convergence into a sequence of valid-but-goal-unbound Work Units.',
  );
  assert.equal(subagentCalls,0,'goal-unbound Work must be rejected before it reaches the Executor');
  assert.equal(rootCalls,1,'the original trigger must not buy another Root cognition round after goal-unbound Work is rejected');
});
