import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { CompletionEvaluator } from '../src/governance/completion-evaluator.js';

function task(){return{id:'T-COMP',title:'完成契约',instruction:'完成这个任务',projectScopes:[],attachments:[],references:[],ready_reason:'NEW',analysisState:null,taskContract:{id:'TC-T-COMP',revision:1,authority:{networkAccess:{value:false,certification:'supported'}},obligations:[{id:'OBL-T-COMP-GOAL',certification:'supported',requirementRefs:[{sourceId:'REQ-T-COMP-0001',start:0,end:6}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}}],constraints:[]},requirementSources:[{id:'REQ-T-COMP-0001',text:'完成这个任务'}]};}
function rootDecision(){return{kind:'complete',summary:'done',stageResult:'done',finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};}
function runtimeWith(assessmentFactory){let rootTurns=0;const executor={async runRoot(){rootTurns+=1;return rootDecision();},async runSubagent(){throw new Error('unexpected subagent');}};const modelRouter=new ModelRouter();const subagentRuntime=new SubagentRuntime({executor,modelRouter});const completionAssessmentVerifier={async review(){return{checked:true,assessments:[assessmentFactory()]};}};const runtime=new RootRuntime({executor,modelRouter,subagentRuntime,completionAssessmentVerifier,completionEvaluator:new CompletionEvaluator()});return{runtime,rootTurns:()=>rootTurns};}

test('certified obligation satisfaction is aggregated only by CompletionEvaluator into goal_satisfied',async()=>{const {runtime,rootTurns}=runtimeWith(()=>({id:'ASSESS:GOAL',certification:'supported',obligationRefs:['OBL-T-COMP-GOAL'],coverage:'covered',outcome:'succeeded',evidenceRefs:['E-1']}));const outcome=await runtime.execute(task());assert.equal(outcome.kind,'goal_satisfied');assert.equal(outcome.goalState,'satisfied');assert.equal(outcome.proposal.finalResult,'done');assert.equal(rootTurns(),1);});

test('unsatisfied completion is a one-shot invalid Root decision, not another model repair turn',async()=>{const {runtime,rootTurns}=runtimeWith(()=>({id:'ASSESS:GOAL',certification:'unresolved',obligationRefs:['OBL-T-COMP-GOAL'],coverage:'uncovered',outcome:'unresolved',evidenceRefs:[]}));await assert.rejects(runtime.execute(task()),/ROOT_INVALID_COMPLETION_DECISION/);assert.equal(rootTurns(),1,'CompletionEvaluator must not trigger a second Root call over the same state');});

test('completion ledger failure is surfaced directly without consuming a fake Root repair turn',async()=>{
  let rootTurns=0;
  const executor={async runRoot(){rootTurns+=1;return rootDecision();},async runSubagent(){throw new Error('unexpected subagent');}};
  const modelRouter=new ModelRouter();
  const subagentRuntime=new SubagentRuntime({executor,modelRouter});
  const completionAssessmentVerifier={async review(){const error=new Error('COMPLETION_LEDGER_UNAVAILABLE');error.nonRetryable=true;throw error;}};
  const runtime=new RootRuntime({executor,modelRouter,subagentRuntime,completionAssessmentVerifier,completionEvaluator:new CompletionEvaluator()});
  await assert.rejects(runtime.execute(task()),/COMPLETION_LEDGER_UNAVAILABLE/);
  assert.equal(rootTurns,1);
});
