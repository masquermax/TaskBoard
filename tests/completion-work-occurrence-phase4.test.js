import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { CompletionAssessmentVerifier } from '../src/governance/completion-assessment-verifier.js';
import { CompletionEvaluator } from '../src/governance/completion-evaluator.js';

function governedTask({withCertifiedHumanFact=false}={}){
  const instruction='检查附件并给出完整结论';
  const current=withCertifiedHumanFact?{
    resultMode:'analysis',
    evidence:[{id:'E-HUMAN',strength:'direct',kind:'fact',sourceType:'human',coverage:'full',statement:'附件要求已全部核验并满足',basis:'human',locator:'human:acceptance',observation:'附件要求已全部核验并满足'}],
    claims:[{id:'C-HUMAN',statement:'附件要求已全部核验并满足',level:'confirmed',evidenceIds:['E-HUMAN'],scope:'general',coverage:'full',hops:[]}],
    gaps:[],recommendations:[],steps:[],
  }:undefined;
  return{
    id:'T-WORK-OCCURRENCE',title:'Completion work occurrence',instruction,
    projectScopes:[{id:'P-1',name:'project'}],attachments:[],references:[],ready_reason:'NEW',
    analysisState:current?{version:1,current,turns:[]}:null,
    taskContract:{id:'TC-T-WORK-OCCURRENCE',revision:1,authority:{networkAccess:{value:false,certification:'supported'},projectWrite:{value:false,certification:'supported'}},obligations:[{id:'OBL-T-WORK-OCCURRENCE-GOAL',certification:'supported',requirementRefs:[{sourceId:'REQ-T-WORK-OCCURRENCE-0001',start:0,end:instruction.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}}],constraints:[]},
    requirementSources:[{id:'REQ-T-WORK-OCCURRENCE-0001',text:instruction}],
  };
}

function rootDecision(){return{kind:'complete',summary:'done',stageResult:'done',finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};}

function makeRuntime(){
  let completionValidatorCalls=0;
  const executor={
    async runRoot(){return rootDecision();},
    async runSubagent(){throw new Error('unexpected subagent');},
    async runValidator({candidates}){completionValidatorCalls+=1;return{reviews:candidates.map(candidate=>({id:candidate.id,verdict:candidate.proofMaterial?.some(item=>item.id==='E-HUMAN'||item.id==='C-HUMAN')?'supported':'overreach',reason:'certified fact check'}))};},
  };
  const modelRouter=new ModelRouter();
  const subagentRuntime=new SubagentRuntime({executor,modelRouter});
  const validatorRuntime={reviewRoot({decision}){return{outcome:'pass',decision,feedback:[],actions:[],requiresRootDecision:false};}};
  const governanceCompiler={compileForTask(){return{taskMode:'analysis'};},compileForRole(){return{taskMode:'analysis'};}};
  const completionAssessmentVerifier=new CompletionAssessmentVerifier({executor});
  return{runtime:new RootRuntime({executor,modelRouter,subagentRuntime,validatorRuntime,governanceCompiler,completionAssessmentVerifier,completionEvaluator:new CompletionEvaluator()}),completionValidatorCalls:()=>completionValidatorCalls};
}

test('0 WorkUnits plus sufficient certified Human facts can satisfy Completion',async()=>{
  const task=governedTask({withCertifiedHumanFact:true});
  const {runtime}=makeRuntime();
  const outcome=await runtime.execute(task);
  assert.equal(outcome.kind,'goal_satisfied');
  assert.equal(outcome.goalState,'satisfied');
});

test('100 issued WorkUnits plus insufficient certified facts remain unsatisfied',async()=>{
  const task=governedTask();
  const {runtime,completionValidatorCalls}=makeRuntime();
  const session=runtime.createSession(task);
  for(let index=0;index<100;index+=1)session.issuedWorkSignatures.add(`WU-${index+1}`);
  await assert.rejects(runtime.execute(task),/ROOT_COMPLETION_NON_CONVERGENCE/);
  assert.equal(completionValidatorCalls(),0,'work occurrence must not manufacture certified proof material');
});
