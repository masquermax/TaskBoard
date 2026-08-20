import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { WorkUnitStatus } from '../src/core/types.js';

function work(){return{id:'WU-1',title:'bounded work',goal:'do one thing',expectedOutput:'result',stopCondition:'result returned',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};}
function runtimeWith(subagentRuntime={run:async()=>({delegationId:'WU-1',result:'ok',evidence:[],blocker:null})}){
  return new RootRuntime({executor:{},modelRouter:{release(){}},subagentRuntime,retryDelaysMs:[1,1,1,1]});
}

test('manual Work Unit retry resets only the Work Unit attempt timing',()=>{
  const task={id:'T',started_at:'2026-08-20T00:00:00.000Z',analysisState:null,workReceipts:[]},runtime=runtimeWith(),session=runtime.createSession(task),stage=runtime.createStage(session,[work()]),unit=stage.workUnits[0],issuedAt=unit.issuedAt;
  Object.assign(unit,{status:WorkUnitStatus.SUSPENDED,startedAt:'2026-08-20T00:01:00.000Z',completedAt:'2026-08-20T00:02:00.000Z',result:{delegationId:'WU-1',result:'stale'},failureCount:3,owner:'subagent'});

  assert.equal(runtime.retryWorkUnit(task.id,unit.id),true);
  assert.equal(task.started_at,'2026-08-20T00:00:00.000Z','retrying a Work Unit must not redefine Task start time');
  assert.equal(unit.issuedAt,issuedAt,'the Work Unit identity/issue time stays stable');
  assert.equal(unit.status,WorkUnitStatus.WAITING_RESOURCE);
  assert.equal(unit.failureCount,0);
  assert.equal(unit.startedAt,null,'the old attempt start must not masquerade as the new attempt start');
  assert.equal(unit.completedAt,null);
  assert.equal(unit.result,null);
});

test('automatic retry records the successful attempt start instead of the first failed attempt',async()=>{
  let runtime,calls=0;const starts=[];
  const subagentRuntime={async run(task,delegation,options){calls+=1;options.onExecutionStarted?.();starts.push(runtime.snapshot(task.id).stage.workUnits[0].startedAt);if(calls===1)throw new Error('executor timeout');return{delegationId:delegation.id,result:'ok',evidence:[],blocker:null};}};
  runtime=runtimeWith(subagentRuntime);
  const task={id:'T-AUTO',analysisState:null,workReceipts:[]},session=runtime.createSession(task),stage=runtime.createStage(session,[work()]),unit=stage.workUnits[0];

  await runtime.startSubagent(task,session,unit,{});
  assert.equal(unit.status,WorkUnitStatus.RETRY_WAIT);
  assert.equal(unit.startedAt,null,'while waiting for retry, the failed attempt is no longer the active timing window');

  await new Promise(resolve=>setTimeout(resolve,5));
  unit.nextRetryAt=Date.now();let receipt=null;
  await runtime.startSubagent(task,session,unit,{onWorkReceipt:value=>{receipt=value;}});

  assert.equal(calls,2);
  assert.equal(unit.status,WorkUnitStatus.COMPLETED);
  assert.notEqual(starts[1],starts[0]);
  assert.equal(unit.startedAt,starts[1]);
  assert.equal(receipt.started_at,starts[1],'durable receipt timing belongs to the successful attempt');
});
