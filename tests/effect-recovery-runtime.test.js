import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { WorkUnitStatus } from '../src/core/types.js';

function baseRuntime(subagentRuntime){
  return new RootRuntime({
    executor:{},
    modelRouter:{release(){}},
    subagentRuntime,
    maxConcurrentSubagents:1,
  });
}

function task(){return{id:'T-EFFECT',title:'effect',instruction:'effect',projectScopes:[],attachments:[],references:[],analysisState:null,workReceipts:[],last_stage_result:null};}
function writeUnit(){return{
  id:'WU-EFFECT',title:'write',goal:'change reality',expectedOutput:'done',stopCondition:'changed',
  projectAccess:'write',networkAccess:false,requiredCapabilities:{projectAccess:'write',networkAccess:false},
  inputRefs:['project:0'],skillId:null,dependsOn:[],status:WorkUnitStatus.WAITING_RESOURCE,
  detail:'',updatedAt:new Date().toISOString(),failureCount:0,nextRetryAt:Date.now(),result:null,owner:null,effectRecoveryRequired:false,
};}

function transportError(){const error=new Error('stream disconnected before completion');error.retryable=true;return error;}
function capacityError(){const error=new Error('capacity');error.capacityUnavailable=true;return error;}

test('D-023: an effect-capable attempt that loses transport after execution starts is not blindly replayed',async()=>{
  let mutations=0;
  const attempts=new Map();
  const runtime=baseRuntime({
    async run(_task,_work,{onExecutionStarted}){
      onExecutionStarted?.();
      mutations+=1;
      throw transportError();
    },
  });
  const t=task();const session=runtime.createSession(t);session.currentStage={id:'stage-1',title:'current',startedAt:new Date().toISOString(),workUnits:[writeUnit()]};
  const unit=session.currentStage.workUnits[0];
  await runtime.startSubagent(t,session,unit,{
    onEffectAttempt:attempt=>attempts.set(attempt.id,attempt),
    onEffectAttemptCleared:id=>attempts.delete(id),
    onProgress(){},onExecutionStarted(){},
  });

  assert.equal(mutations,1);
  assert.equal(unit.status,WorkUnitStatus.SUSPENDED);
  assert.equal(unit.effectRecoveryRequired,true);
  assert.equal(unit.nextRetryAt,null);
  assert.equal(attempts.size,1,'UNKNOWN effect outcome must remain durable recovery truth');
  assert.equal(runtime.retryWorkUnit(t.id,unit.id),false,'manual Work Unit retry cannot assert that the prior effect did not happen');
});

test('D-023: pre-start capacity shortage clears admission and retains normal resource-wait behavior',async()=>{
  const attempts=new Map();
  const runtime=baseRuntime({async run(){throw capacityError();}});
  const t=task();const session=runtime.createSession(t);session.currentStage={id:'stage-1',title:'current',startedAt:new Date().toISOString(),workUnits:[writeUnit()]};
  const unit=session.currentStage.workUnits[0];
  await runtime.startSubagent(t,session,unit,{
    onEffectAttempt:attempt=>attempts.set(attempt.id,attempt),
    onEffectAttemptCleared:id=>attempts.delete(id),
    onProgress(){},onExecutionStarted(){},
  });

  assert.equal(attempts.size,0,'no effect-capable control was obtained');
  assert.equal(unit.status,WorkUnitStatus.WAITING_RESOURCE);
  assert.equal(unit.effectRecoveryRequired,false);
});

test('D-023: a successful WorkReceipt can atomically close the matching effect attempt',async()=>{
  const attempts=new Map();
  let receipt=null;
  const runtime=baseRuntime({async run(_task,_work,{onExecutionStarted}){onExecutionStarted?.();return{delegationId:'WU-EFFECT',result:'done',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};}});
  const t=task();const session=runtime.createSession(t);session.currentStage={id:'stage-1',title:'current',startedAt:new Date().toISOString(),workUnits:[writeUnit()]};
  const unit=session.currentStage.workUnits[0];
  await runtime.startSubagent(t,session,unit,{
    onEffectAttempt:attempt=>attempts.set(attempt.id,attempt),
    onEffectAttemptCleared:id=>attempts.delete(id),
    onWorkReceipt:value=>{receipt=value;attempts.delete(value.effectAttemptId);},
    onProgress(){},onExecutionStarted(){},
  });

  assert.ok(receipt?.effectAttemptId);
  assert.equal(attempts.size,0);
  assert.equal(unit.status,WorkUnitStatus.COMPLETED);
});
