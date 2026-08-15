import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

function referenceEvidence(id='E-1') {
  return {
    id,
    strength:'direct',
    kind:'fact',
    sourceType:'reference',
    coverage:'component',
    statement:'事实成立',
    basis:'reference:R-1',
    locator:'reference:R-1',
    observation:'事实成立',
  };
}

function confirmedClaim(id='C-1', evidenceIds=['E-1']) {
  return {
    id,
    statement:'事实成立',
    level:'confirmed',
    evidenceIds,
    scope:'single_system',
    coverage:'component',
    hops:[],
  };
}

function candidate(overrides={}) {
  return {
    kind:'delegate',
    summary:'execution control',
    stageResult:null,
    finalResult:null,
    resultMode:'execution',
    evidence:[],
    claims:[],
    gaps:[],
    recommendations:[],
    steps:[],
    gapResolutions:[],
    delegations:[],
    gateway:null,
    ...overrides,
  };
}

test('Gate B: execution presentation cannot bypass C-003 Candidate certification',()=>{
  const validator=new AnalysisResultValidator();
  const checked=validator.validateAndRepair(candidate({
    stageResult:'Root-authored durable text',
    finalResult:'keep execution presentation',
    claims:[confirmedClaim('C-UNPROVEN',[])],
  }),{taskMode:'execution'});

  assert.equal(checked.valid,true);
  assert.equal(checked.decision.resultMode,'execution');
  assert.equal(checked.decision.finalResult,'keep execution presentation');
  assert.equal(checked.decision.stageResult,null,'Root stageResult is not Validator-certified History');
  assert.equal(checked.decision.claims.length,0,'unsupported execution Claim must not bypass C-003');
  assert.ok(checked.decision.gaps.some(gap=>/事实成立/.test(gap.question)));
});

test('Gate B: semantic proof eligibility is independent of taskMode/resultMode',async()=>{
  let semanticCalls=0;
  const runtime=new ValidatorRuntime({
    analysisValidator:new AnalysisResultValidator(),
    sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:[]})},
    semanticVerifier:{
      async review(){semanticCalls+=1;return{checked:false,reviews:[],actions:[]};},
    },
  });
  const reviewed=runtime.reviewRoot({
    decision:candidate({evidence:[referenceEvidence()],claims:[confirmedClaim()]}),
    policyContext:{taskMode:'execution'},
    task:{id:'T-SEM'},
  });
  assert.equal(reviewed.outcome,'pass');
  await runtime.semanticReviewRoot({reviewed,policyContext:{taskMode:'execution'},task:{id:'T-SEM'}});
  assert.equal(semanticCalls,1);
});

test('Gate B: governed execution Candidate cannot bypass a missing ValidatorRuntime',async()=>{
  const executor={
    async runRoot({onExecutionStarted}){
      onExecutionStarted?.();
      return candidate({kind:'complete',summary:'done',finalResult:'done',evidence:[referenceEvidence()],claims:[confirmedClaim()]});
    },
    async runSubagent(){throw new Error('unused');},
  };
  const router=new ModelRouter();
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:null});

  await assert.rejects(
    root.execute({id:'T-GOV',title:'执行',instruction:'执行并形成受治理结论',projectScopes:[],attachments:[],references:[]}),
    /VALIDATOR_RUNTIME_REQUIRED: governed Candidate Delta cannot bypass Validator ownership/
  );
});

test('Gate B: Root-authored stageResult is not a durable History source',async()=>{
  let stageResultWrites=0;
  const executor={
    async runRoot({onExecutionStarted}){
      onExecutionStarted?.();
      return candidate({kind:'complete',summary:'done',stageResult:'ROOT-STAGE',finalResult:'execution finished'});
    },
    async runSubagent(){throw new Error('unused');},
  };
  const router=new ModelRouter();
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:null});
  const outcome=await root.execute(
    {id:'T-STAGE',title:'执行',instruction:'执行',projectScopes:[],attachments:[],references:[]},
    {onStageResult:()=>{stageResultWrites+=1;}}
  );

  assert.equal(outcome.kind,'goal_satisfied');
  assert.equal(outcome.proposal.finalResult,'execution finished');
  assert.equal(outcome.proposal.stageResult,null);
  assert.equal(stageResultWrites,0);
});
