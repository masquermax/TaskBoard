import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../src/core/model-router.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';

const policySourceVerifier={enforce:({evidence})=>({evidence:Array.isArray(evidence)?evidence:[],actions:[],verifications:(Array.isArray(evidence)?evidence:[]).map(item=>({id:item.id,checked:true,verified:true,traceable:true}))})};
function decision(){return{kind:'complete',summary:'candidate',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};}

test('Validator source ledger has no model resource lifecycle',()=>{
  const runtime=new ValidatorRuntime({sourceTraceVerifier:policySourceVerifier});
  const reviewed=runtime.reviewRoot({decision:decision(),task:{id:'T'}});
  assert.equal(reviewed.outcome,'pass');
  assert.equal(typeof runtime.semanticReviewRoot,'undefined');
  assert.equal('semanticVerifier' in runtime,false);
  assert.equal('analysisValidator' in runtime,false);
  assert.equal('pendingValidation' in reviewed,false);
});

test('Subagent execution remains one bounded turn and Runtime strips every judgment field',async()=>{
  let subagentCalls=0;
  const executor={async runSubagent({onExecutionStarted}){subagentCalls+=1;onExecutionStarted?.();return{delegationId:'w',result:'local',evidence:[],findings:[{id:'F-1',statement:'local finding',evidenceIds:[]}],discoveries:[{summary:'next'}],blocker:null,uncertainty:'maybe'};}};
  const subagent=new SubagentRuntime({executor,modelRouter:new ModelRouter(),sourceTraceVerifier:policySourceVerifier});
  const task={id:'T',title:'Subagent boundary',instruction:'分析',projectScopes:[],attachments:[],references:[]};
  const result=await subagent.run(task,{id:'w',title:'W',goal:'W',expectedOutput:'返回局部执行结果',stopCondition:'局部工作完成后停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},{policyContext:{taskMode:'analysis'}});
  assert.equal(subagentCalls,1);
  assert.deepEqual(result,{delegationId:'w',result:'local',evidence:[],blocker:null});
});

test('Validator source checking is stateless across Tasks',()=>{
  const runtime=new ValidatorRuntime({sourceTraceVerifier:policySourceVerifier});
  const first=runtime.reviewRoot({decision:decision(),task:{id:'T-1'}});
  const second=runtime.reviewRoot({decision:decision(),task:{id:'T-2'}});
  assert.equal(first.outcome,'pass');assert.equal(second.outcome,'pass');
  assert.equal('pendingValidation' in first,false);assert.equal('pendingValidation' in second,false);
});
