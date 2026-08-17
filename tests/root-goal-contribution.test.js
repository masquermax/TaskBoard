import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

const baseDecision={stageResult:null,finalResult:null,resultMode:'execution',evidence:[],claims:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};
function targetGap(){return{id:'G-TARGET',question:'What exact runtime fact is still missing to satisfy the current governed goal?',reason:'The goal cannot be advanced reliably until this specific runtime fact is known.',kind:'missing_fact',blocking:false,evidenceIds:[]};}
function unrelatedWork(){return{id:'WU-UNBOUND',title:'Inventory unrelated repository metadata',goal:'Read unrelated repository metadata that does not answer G-TARGET.',expectedOutput:'Return the unrelated metadata.',stopCondition:'Stop after returning that metadata.',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};}
function targetedWork(id,title){return{id,title,goal:`Try one bounded acquisition path for G-TARGET: ${title}.`,expectedOutput:'Return the discriminator result for G-TARGET.',stopCondition:'Stop after the bounded discriminator returns, including a negative result.',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[],targetGapIds:['G-TARGET']};}
function runtimeFor(executor){const modelRouter=new ModelRouter();const subagentRuntime=new SubagentRuntime({executor,modelRouter});return new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter,subagentRuntime});}
function task(id){return{id,title:'Close the governed runtime deficit',instruction:'Resolve the current governed runtime deficit with the minimum necessary work.',projectScopes:[],attachments:[],references:[],analysisState:null,workReceipts:[],taskContract:{authority:{}}};}

test('new Work without a machine-checkable governed contribution is rejected before Executor admission',async()=>{
  let rootCalls=0,subagentCalls=0;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){rootCalls+=1;onExecutionStarted?.();if((subagentResults||[]).length)return{...baseDecision,kind:'complete',summary:'unrelated work returned, but governed deficit is unchanged',finalResult:'done',gaps:[]};return{...baseDecision,kind:'delegate',summary:'issue a structurally valid but goal-unbound Work Unit',gaps:[targetGap()],delegations:[unrelatedWork()]};},
    async runSubagent({delegation,onExecutionStarted}){subagentCalls+=1;onExecutionStarted?.();return{delegationId:delegation.id,result:'unrelated metadata',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};},
  };
  await assert.rejects(runtimeFor(executor).execute(task('T-GOAL-CONTRIBUTION')),/ROOT_WORK_WITHOUT_GOVERNED_CONTRIBUTION/,'Root must not be able to turn narrative non-convergence into valid-but-goal-unbound Work Units.');
  assert.equal(subagentCalls,0);assert.equal(rootCalls,1);
});

test('declaring the same Gap target does not buy another Work after the prior result produced no state-bearing delta',async()=>{
  let rootCalls=0,subagentCalls=0;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      if(rootCalls===1)return{...baseDecision,kind:'delegate',summary:'first bounded discriminator',gaps:[targetGap()],delegations:[targetedWork('WU-TRY-1','first method')]};
      if(rootCalls===2){assert.equal((subagentResults||[])[0]?.delegationId,'WU-TRY-1');return{...baseDecision,kind:'delegate',summary:'try another method without changing the governed problem state',gaps:[],delegations:[targetedWork('WU-TRY-2','second method')]};}
      return{...baseDecision,kind:'complete',summary:'should not reach a third Root turn',finalResult:'done',gaps:[]};
    },
    async runSubagent({delegation,onExecutionStarted}){subagentCalls+=1;onExecutionStarted?.();return{delegationId:delegation.id,result:'bounded attempt returned no evidence that changes G-TARGET',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:'G-TARGET remains unchanged'};},
  };
  await assert.rejects(runtimeFor(executor).execute(task('T-GAP-NO-DELTA')),/ROOT_WORK_WITHOUT_STATE_ADVANCE/,'A self-declared Gap target must not become a license for repeated cognition when the previous targeted Work changed no governed state.');
  assert.equal(subagentCalls,1,'only the first bounded discriminator may execute before the no-progress boundary is enforced');
  assert.equal(rootCalls,2,'the first Work result may trigger one Root synthesis, but that synthesis cannot buy another unchanged-gap Work');
});
