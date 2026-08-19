import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkUnitObservability } from '../src/core/work-unit-observability.js';

function command(id,command,output,status='completed',durationMs=null){
  return {id,type:'commandExecution',command,cwd:'C:/repo',aggregatedOutput:output,status,exitCode:status==='completed'?0:1,...(durationMs==null?{}:{durationMs})};
}

test('Work Unit observability reports duplicate operations, sources, verified evidence and post-saturation calls',()=>{
  const base=Date.parse('2026-08-19T00:00:00.000Z');
  const emitted=[];
  const observer=new WorkUnitObservability({
    taskId:'T-0009',workUnitId:'authority-evidence',turnId:'turn-1',startedAt:base,
    stopCondition:'1. identify authority owner\n2. identify evidence owner\n3. cite the runtime path',
    emitDiagnostic:(event,data,level)=>emitted.push({event,level,...data}),
  });

  observer.start({id:'a',type:'commandExecution',command:'rg "Authority" src/core'},base+10_000);
  observer.complete(command('a','rg "Authority" src/core','src/core/root-runtime.js:10: Authority\n', 'completed', 800),base+10_800);

  observer.start({id:'b',type:'commandExecution',command:'Get-Content src/core/root-runtime.js'},base+30_000);
  observer.complete(command('b','Get-Content src/core/root-runtime.js','source body','completed',600),base+30_600);

  observer.start({id:'c',type:'commandExecution',command:'Get-Content src/core/root-runtime.js'},base+60_000);
  observer.complete(command('c','Get-Content src/core/root-runtime.js','source body','completed',500),base+60_500);

  observer.noteConvergenceSteer(base+50_000);
  const finalized=observer.finalize({
    evidence:[{id:'E-1',locator:'src/core/root-runtime.js'}],
    completedAt:base+90_000,
    status:'completed',blocker:null,uncertainty:null,
  });

  assert.equal(finalized.summary.toolCallCount,3);
  assert.equal(finalized.summary.uniqueToolCalls,2);
  assert.equal(finalized.summary.duplicateToolCalls,1);
  assert.equal(finalized.summary.duplicateRatio,0.3333);
  assert.equal(finalized.summary.uniqueSourcesTouched,1);
  assert.equal(finalized.summary.newEvidenceCount,1);
  assert.equal(finalized.summary.attributedEvidenceCount,1);
  assert.equal(finalized.summary.lastNewEvidenceAt,new Date(base+10_800).toISOString());
  assert.equal(finalized.summary.postSaturationCalls,2);
  assert.equal(finalized.summary.timeAfterLastNewEvidenceMs,79_200);
  assert.equal(finalized.summary.callsAfterConvergenceSteer,1);
  assert.deepEqual(finalized.summary.stopConditionProgress,{
    satisfied:3,total:3,status:'reported-satisfied',basis:'work-unit-return-without-blocker',satisfiedAt:new Date(base+90_000).toISOString(),
  });

  assert.equal(finalized.toolEvents[0].toolCallName,'rg');
  assert.equal(finalized.toolEvents[0].operationClass,'search');
  assert.equal(finalized.toolEvents[0].newSourceCount,1);
  assert.equal(finalized.toolEvents[0].newEvidenceCount,1);
  assert.equal(finalized.toolEvents[2].duplicateOperation,true);
  assert.equal(finalized.toolEvents[2].elapsedSinceLastNewEvidenceMs,49_700);
  assert.equal(emitted.length,0,'pure collector does not publish until registry finalization');
});

test('unattributed verified Evidence is never fabricated as a per-tool evidence acquisition time',()=>{
  const base=Date.parse('2026-08-19T00:00:00.000Z');
  const observer=new WorkUnitObservability({taskId:'T-1',workUnitId:'W-1',turnId:'turn-x',startedAt:base,stopCondition:'done'});
  observer.start({id:'x',type:'commandExecution',command:'node --version'},base+1000);
  observer.complete(command('x','node --version','v24.0.0','completed',20),base+1020);
  const finalized=observer.finalize({evidence:[{id:'E',locator:'external/runtime'}],completedAt:base+5000,status:'completed'});
  assert.equal(finalized.toolEvents[0].newEvidenceCount,0);
  assert.equal(finalized.summary.attributedEvidenceCount,0);
  assert.equal(finalized.summary.unattributedEvidenceCount,1);
  assert.equal(finalized.summary.evidenceTimingBasis,'turn-final-unattributed');
  assert.equal(finalized.summary.postSaturationCalls,null);
});
