import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { CompletionEvaluator } from '../src/governance/completion-evaluator.js';

function governedTask({mapped=false}={}){
  const instruction='检查附件并给出完整结论',obligationId='OBL-T-WORK-OCCURRENCE-GOAL';
  const current=mapped?{resultMode:'analysis',evidence:[{id:'E-HUMAN',strength:'direct',kind:'fact',sourceType:'human',coverage:'full',statement:'附件要求已全部核验并满足',basis:'human',locator:'human:acceptance',observation:'附件要求已全部核验并满足'}],claims:[{id:'C-HUMAN',statement:'附件要求已全部核验并满足',level:'confirmed',evidenceIds:['E-HUMAN'],scope:'general',coverage:'full',hops:[],obligationRefs:[obligationId]}],gaps:[],recommendations:[],steps:[]}:undefined;
  return{id:'T-WORK-OCCURRENCE',title:'Completion work occurrence',instruction,projectScopes:[],attachments:[],references:[],ready_reason:'NEW',workReceipts:[],analysisState:current?{version:1,current,turns:[]}:null,taskContract:{id:'TC-T-WORK-OCCURRENCE',revision:1,authority:{},obligations:[{id:obligationId,certification:'supported',requirementRefs:[{sourceId:'REQ-T-WORK-OCCURRENCE-0001',start:0,end:instruction.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}}],constraints:[]},requirementSources:[{id:'REQ-T-WORK-OCCURRENCE-0001',text:instruction}]};
}
function rootDecision(){return{kind:'complete',summary:'done',finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};}
function makeRuntime(){const executor={async runRoot(){return rootDecision();},async runSubagent(){throw new Error('unexpected subagent');}};const modelRouter=new ModelRouter();return new RootRuntime({executor,modelRouter,subagentRuntime:new SubagentRuntime({executor,modelRouter}),completionEvaluator:new CompletionEvaluator()});}

test('zero Work Units can complete when Certified State already contains Root-owned explicit obligation mapping',async()=>{
  const outcome=await makeRuntime().execute(governedTask({mapped:true}));assert.equal(outcome.kind,'goal_satisfied');assert.equal(outcome.goalState,'satisfied');
});

test('Work occurrence cannot manufacture Completion truth without an explicit certified obligation mapping',async()=>{
  const runtime=makeRuntime(),task=governedTask(),session=runtime.createSession(task);for(let index=0;index<100;index+=1){session.issuedWorkIds.add(`WU-${index+1}`);session.issuedWorkSignatures.add(`sig-${index+1}`);}await assert.rejects(runtime.execute(task),/ROOT_INVALID_COMPLETION_DECISION/);
});
