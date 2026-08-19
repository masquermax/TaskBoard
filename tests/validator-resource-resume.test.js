import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../src/core/model-router.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';

const policySourceVerifier={enforce:({evidence})=>({evidence:Array.isArray(evidence)?evidence:[],actions:[],verifications:(Array.isArray(evidence)?evidence:[]).map(item=>({id:item.id,checked:true,verified:true,traceable:true}))})};

function decision(){return{kind:'complete',summary:'candidate',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};}

test('Validator candidate certification has no semantic-model resource lifecycle',async()=>{
  let semanticCalls=0;
  const runtime=new ValidatorRuntime({
    analysisValidator:new AnalysisResultValidator(),
    sourceTraceVerifier:policySourceVerifier,
    semanticVerifier:{async review(){semanticCalls+=1;throw new Error('MODEL_MUST_NOT_RUN');}},
  });
  const reviewed=runtime.reviewRoot({decision:decision(),task:{id:'T'},seenKnowledgeKeys:new Set()});
  assert.equal(reviewed.outcome,'pass');
  const semantic=await runtime.semanticReviewRoot({reviewed,task:{id:'T'}});
  assert.equal(semantic,reviewed);
  assert.equal(semanticCalls,0);
});

test('Subagent execution remains one bounded turn and returns no judgment fields',async()=>{
  let subagentCalls=0;
  const executor={async runSubagent({onExecutionStarted}){
    subagentCalls+=1;onExecutionStarted?.();
    return{delegationId:'w',result:'local',evidence:[],findings:[{id:'F-1',statement:'local finding',evidenceIds:[]}],discoveries:[{summary:'next'}],blocker:null,uncertainty:'maybe'};
  }};
  const subagent=new SubagentRuntime({executor,modelRouter:new ModelRouter(),sourceTraceVerifier:policySourceVerifier});
  const task={id:'T',title:'Subagent boundary',instruction:'分析',projectScopes:[],attachments:[],references:[]};
  const result=await subagent.run(task,{id:'w',title:'W',goal:'W',expectedOutput:'返回局部执行结果',stopCondition:'局部工作完成后停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},{policyContext:{taskMode:'analysis'}});
  assert.equal(subagentCalls,1);
  assert.deepEqual(result,{delegationId:'w',result:'local',evidence:[],blocker:null});
  assert.equal('findings' in result,false);
  assert.equal('discoveries' in result,false);
  assert.equal('uncertainty' in result,false);
});

test('Validator keeps source checking stateless; no model retry or resume state is required',()=>{
  const runtime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),sourceTraceVerifier:policySourceVerifier});
  const first=runtime.reviewRoot({decision:decision(),task:{id:'T-1'},seenKnowledgeKeys:new Set()});
  const second=runtime.reviewRoot({decision:decision(),task:{id:'T-2'},seenKnowledgeKeys:new Set()});
  assert.equal(first.outcome,'pass');
  assert.equal(second.outcome,'pass');
  assert.equal('pendingValidation' in first,false);
  assert.equal('pendingValidation' in second,false);
});
