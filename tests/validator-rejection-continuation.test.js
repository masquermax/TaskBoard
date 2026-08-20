import test from 'node:test';
import assert from 'node:assert/strict';
import { ExecutorPort } from '../src/core/executor-port.js';
import { ExecutorRuntimeAdapter } from '../src/core/executor-runtime.js';
import { RootRuntime } from '../src/core/root-runtime.js';

function complete(summary){return{kind:'complete',summary,finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};}

class CaptureExecutor extends ExecutorPort{
  constructor(){super();this.calls=[];}
  async execute(request){this.calls.push(request);request.onExecutionStarted?.();return complete(this.calls.length===1?'candidate rejected':'candidate corrected');}
}

function task(){
  return{
    id:'T-REJECT',title:'validator rejection',instruction:'use the completed source check',ready_reason:'NEW',
    projectScopes:[],attachments:[],references:[],analysisState:null,taskContract:{obligations:[]},
    workReceipts:[{
      id:'WU-1',signature:'sig-1',consumed_at:null,
      workUnit:{id:'WU-1',title:'source check',goal:'read source',expectedOutput:'source fact',stopCondition:'fact returned',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},
      result:{delegationId:'WU-1',result:'raw observation',evidence:[],blocker:null},
    }],
  };
}

test('Validator rejection is a Root delta, not a Scheduler suspension or receipt loss',async()=>{
  const extensionExecutor=new CaptureExecutor(),executor=new ExecutorRuntimeAdapter(extensionExecutor);let reviews=0;
  const validatorRuntime={
    reviewRoot({decision}){
      reviews+=1;
      if(reviews===1)return{outcome:'reject',decision,feedback:[{ruleId:'C-003',target:'evidence:E1',reason:'指定行范围中不存在该 observation；来源凭证与原文不一致。',action:'REJECT_UNTRACEABLE_SOURCE'}],actions:[{action:'REJECT_UNTRACEABLE_SOURCE',target:'E1',reason:'source mismatch'}]};
      return{outcome:'pass',decision,feedback:[],actions:[]};
    },
  };
  const modelRouter={async prepare(){},route(){return{};},release(){}};
  const completionEvaluator={evaluate(){return{goalState:'satisfied',satisfiedObligationIds:[],unsatisfiedObligationIds:[],assessments:[]};}};
  const root=new RootRuntime({executor,modelRouter,subagentRuntime:{},validatorRuntime,completionEvaluator});
  const consumed=[];let certifiedTurns=0;

  const outcome=await root.execute(task(),{
    onWorkReceiptsConsumed:ids=>consumed.push([...ids]),
    onCertifiedTurn:()=>{certifiedTurns+=1;},
  });

  assert.equal(outcome.kind,'goal_satisfied');
  assert.equal(reviews,2);
  assert.equal(extensionExecutor.calls.length,2,'Root should immediately re-enter once with the deterministic rejection delta');
  assert.equal(extensionExecutor.calls[0].context.validatorRejection,null);
  assert.equal(extensionExecutor.calls[1].context.validatorRejection.feedback[0].target,'evidence:E1');
  assert.match(extensionExecutor.calls[1].context.validatorRejection.feedback[0].reason,/来源凭证与原文不一致/);
  assert.deepEqual(extensionExecutor.calls.map(call=>call.context.freshWorkResults.map(item=>item.delegationId)),[['WU-1'],['WU-1']],'rejected Candidate must not consume the Work receipt before Root corrects its judgment');
  assert.deepEqual(consumed,[['WU-1']],'receipt is consumed only after a passing Root decision');
  assert.equal(certifiedTurns,0,'rejected Candidate never enters Certified State');
});
