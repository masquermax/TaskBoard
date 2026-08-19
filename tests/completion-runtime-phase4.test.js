import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { CompletionEvaluator } from '../src/governance/completion-evaluator.js';

function task({mapped=false}={}){
  const text='完成这个任务';
  return{id:'T-COMP',title:'完成契约',instruction:text,projectScopes:[],attachments:[],references:[],ready_reason:'NEW',workReceipts:[],taskContract:{id:'TC-T-COMP',revision:1,authority:{},obligations:[{id:'OBL-T-COMP-GOAL',certification:'supported',requirementRefs:[{sourceId:'REQ-T-COMP-0001',start:0,end:text.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}}],constraints:[]},requirementSources:[{id:'REQ-T-COMP-0001',text}],analysisState:mapped?{version:1,current:{resultMode:'analysis',evidence:[],claims:[{id:'C-GOAL',statement:'目标已完成',level:'confirmed',evidenceIds:['E-1'],scope:'general',coverage:'component',hops:[],obligationRefs:['OBL-T-COMP-GOAL']}],gaps:[],recommendations:[],steps:[]},turns:[]}:null};
}
function rootDecision(){return{kind:'complete',summary:'done',stageResult:'done',finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};}
function runtime(){let rootTurns=0;const executor={async runRoot({onExecutionStarted}){rootTurns+=1;onExecutionStarted?.();return rootDecision();},async runSubagent(){throw new Error('unexpected subagent');}};const modelRouter=new ModelRouter();return{runtime:new RootRuntime({executor,modelRouter,subagentRuntime:new SubagentRuntime({executor,modelRouter}),completionEvaluator:new CompletionEvaluator()}),rootTurns:()=>rootTurns};}

test('mapped confirmed completion reaches goal_satisfied in the same Root turn',async()=>{
  const x=runtime();const outcome=await x.runtime.execute(task({mapped:true}));
  assert.equal(outcome.kind,'goal_satisfied');assert.equal(outcome.goalState,'satisfied');assert.equal(x.rootTurns(),1);
});

test('unmapped completion fails closed after one Root turn instead of completion repair',async()=>{
  const x=runtime();await assert.rejects(x.runtime.execute(task()),/ROOT_INVALID_COMPLETION_DECISION/);
  assert.equal(x.rootTurns(),1,'the same state is never sent back to Root as completion feedback');
});
