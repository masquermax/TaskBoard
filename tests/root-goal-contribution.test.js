import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime, validateDelegationPlan } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

const baseDecision={stageResult:null,finalResult:null,resultMode:'execution',evidence:[],claims:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};
function targetGap(){return{id:'G-TARGET',question:'What exact runtime fact is still missing to satisfy the current governed goal?',reason:'The goal cannot be advanced reliably until this specific runtime fact is known.',kind:'missing_fact',blocking:false,evidenceIds:[]};}
function unrelatedWork(){return{id:'WU-UNBOUND',title:'Inventory unrelated repository metadata',goal:'Read unrelated repository metadata that does not answer G-TARGET.',expectedOutput:'Return the unrelated metadata.',stopCondition:'Stop after returning that metadata.',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[],contributionRefs:[]};}
function targetedWork(id,title){return{id,title,goal:`Try one bounded acquisition path for G-TARGET: ${title}.`,expectedOutput:'Return the discriminator result for G-TARGET.',stopCondition:'Stop after the bounded discriminator returns, including a negative result.',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[],contributionRefs:['gap:G-TARGET']};}
function runtimeFor(executor){const modelRouter=new ModelRouter();const subagentRuntime=new SubagentRuntime({executor,modelRouter});return new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter,subagentRuntime});}
function task(id){return{id,title:'Close the governed runtime deficit',instruction:'Resolve the current governed runtime deficit with the minimum necessary work.',projectScopes:[],attachments:[],references:[],analysisState:null,workReceipts:[],taskContract:{authority:{}}};}

// A malformed Root control plan may consume one local repair turn, but the unbound Work itself must never reach execution.
test('new Work without a machine-checkable governed contribution gets one bounded repair and never reaches Executor',async()=>{
  let rootCalls=0,subagentCalls=0;
  const executor={
    async runRoot({planningFeedback,onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      if(planningFeedback?.length){
        assert.match(planningFeedback.join(' | '),/ROOT_WORK_WITHOUT_GOVERNED_CONTRIBUTION/);
        return{...baseDecision,kind:'wait',summary:'No governed machine action remains after the invalid unbound Work was rejected.',gaps:[targetGap()]};
      }
      return{...baseDecision,kind:'delegate',summary:'issue a structurally valid but goal-unbound Work Unit',gaps:[targetGap()],delegations:[unrelatedWork()]};
    },
    async runSubagent({delegation,onExecutionStarted}){subagentCalls+=1;onExecutionStarted?.();return{delegationId:delegation.id,result:'unrelated metadata',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};},
  };
  const outcome=await runtimeFor(executor).execute(task('T-GOAL-CONTRIBUTION'));
  assert.equal(outcome.kind,'suspended');
  assert.match(outcome.reason,/No governed machine action remains/);
  assert.equal(subagentCalls,0,'goal-unbound Work must be stopped before it reaches the Executor');
  assert.equal(rootCalls,2,'one invalid control plan may buy exactly one bounded planning repair, then must converge');
});

test('same governed target cannot buy another Work after the prior result produced no state-bearing delta',async()=>{
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
  const outcome=await runtimeFor(executor).execute(task('T-GAP-NO-DELTA'));
  assert.equal(outcome.kind,'suspended');
  assert.match(outcome.reason,/ROOT_WORK_WITHOUT_STATE_ADVANCE/);
  assert.equal(subagentCalls,1,'only the first bounded discriminator may execute before the no-progress boundary is enforced');
  assert.equal(rootCalls,2,'one Work result may trigger synthesis, but cannot buy another unchanged-target Work');
});

test('Root wait is a structured non-Human convergence result when a governed Gap remains open',async()=>{
  let rootCalls=0,subagentCalls=0;
  const executor={
    async runRoot({onExecutionStarted}){rootCalls+=1;onExecutionStarted?.();return{...baseDecision,kind:'wait',summary:'No safe decision-relevant acquisition path remains.',gaps:[targetGap()]};},
    async runSubagent(){subagentCalls+=1;throw new Error('must not run');},
  };
  const outcome=await runtimeFor(executor).execute(task('T-STRUCTURED-WAIT'));
  assert.equal(outcome.kind,'suspended');
  assert.match(outcome.reason,/No safe decision-relevant acquisition path remains/);
  assert.equal(rootCalls,1);
  assert.equal(subagentCalls,0);
});

test('one canonical obligation may be inferred only while no governed Gap competes for contribution identity',()=>{
  const baseWork={id:'W-1',title:'bounded work',goal:'advance goal',expectedOutput:'fact',stopCondition:'fact returned',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[],contributionRefs:[]};
  const inferred=validateDelegationPlan([baseWork],{availableContributionRefs:['obligation:OBL-T-GOAL']});
  assert.equal(inferred.valid,true);
  assert.deepEqual(inferred.delegations[0].contributionRefs,['obligation:OBL-T-GOAL']);
  const ambiguous=validateDelegationPlan([baseWork],{availableContributionRefs:['obligation:OBL-T-GOAL','gap:G-1']});
  assert.equal(ambiguous.valid,false);
  assert.ok(ambiguous.contributionIssues.length>0);
});
