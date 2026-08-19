import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkUnitObservability } from '../src/core/work-unit-observability.js';

function command(id,command,output,status='completed',durationMs=null){
  return {id,type:'commandExecution',command,cwd:'C:/repo',aggregatedOutput:output,status,exitCode:status==='completed'?0:1,...(durationMs==null?{}:{durationMs})};
}

test('Work Unit observability streams tool completion immediately and derives only exact evidence timing',()=>{
  const base=Date.parse('2026-08-19T00:00:00.000Z');
  const emitted=[];
  const observer=new WorkUnitObservability({
    taskId:'T-0009',workUnitId:'authority-evidence',turnId:'turn-1',startedAt:base,
    stopCondition:'1. identify authority owner\n2. identify evidence owner\n3. cite the runtime path',
    emitDiagnostic:(event,data,level)=>emitted.push({event,level,...data}),
  });

  observer.start({id:'a',type:'commandExecution',command:'rg "Authority" src/core'},base+10_000);
  observer.complete(command('a','rg "Authority" src/core','src/core/root-runtime.js:10: Authority owner is GovernanceCompiler.\n','completed',800),base+10_800);
  assert.equal(emitted.length,1,'tool-completed must be emitted immediately');
  assert.equal(emitted[0].event,'tool-completed');
  assert.equal(emitted[0].newEvidenceCount,null,'Evidence is not guessed before SourceTrace verification');
  assert.equal(emitted[0].elapsedSinceLastNewEvidenceMs,null);
  assert.equal(emitted[0].evidenceState,'pending-verification');

  observer.start({id:'b',type:'commandExecution',command:'Get-Content src/core/root-runtime.js'},base+30_000);
  observer.complete(command('b','Get-Content src/core/root-runtime.js','other source body','completed',600),base+30_600);

  observer.start({id:'c',type:'commandExecution',command:'Get-Content src/core/root-runtime.js'},base+60_000);
  observer.complete(command('c','Get-Content src/core/root-runtime.js','other source body','completed',500),base+60_500);

  observer.noteConvergenceSteer(base+50_000);
  const finalized=observer.finalize({
    evidence:[{id:'E-1',locator:'src/core/root-runtime.js',observation:'Authority owner is GovernanceCompiler.'}],
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
    satisfied:null,total:3,status:'unknown',basis:'not-instrumented',satisfiedAt:null,
  });

  assert.equal(emitted[0].toolCallName,'rg');
  assert.equal(emitted[0].operationClass,'search');
  assert.equal(emitted[0].newSourceCount,1);
  assert.match(emitted[0].operation,/rg "Authority" src\/core/);
  assert.equal(emitted[2].duplicateOperation,true);
  assert.ok(emitted.some(item=>item.event==='tool-evidence-attributed'&&item.seq===1&&item.newEvidenceCount===1));
});

test('ambiguous or unavailable Evidence timing remains unknown instead of being invented',()=>{
  const base=Date.parse('2026-08-19T00:00:00.000Z');
  const observer=new WorkUnitObservability({taskId:'T-1',workUnitId:'W-1',turnId:'turn-x',startedAt:base,stopCondition:'done'});
  observer.start({id:'x',type:'commandExecution',command:'node --version'},base+1000);
  observer.complete(command('x','node --version','v24.0.0','completed',20),base+1020);
  const finalized=observer.finalize({evidence:[{id:'E',locator:'external/runtime',observation:'runtime fact not present in tool output'}],completedAt:base+5000,status:'completed'});
  assert.equal(finalized.summary.attributedEvidenceCount,0);
  assert.equal(finalized.summary.unattributedEvidenceCount,1);
  assert.equal(finalized.summary.evidenceTimingBasis,'unavailable');
  assert.equal(finalized.summary.lastNewEvidenceAt,null);
  assert.equal(finalized.summary.postSaturationCalls,null);

  const partial=new WorkUnitObservability({taskId:'T-2',workUnitId:'W-2',startedAt:base,stopCondition:'done'});
  partial.start({id:'y',type:'commandExecution',command:'git status'},base+2000);
  partial.complete(command('y','git status','clean','completed',20),base+2020);
  const failed=partial.finalize({evidence:null,completedAt:base+3000,status:'failed',blocker:'parse failed'});
  assert.equal(failed.summary.newEvidenceCount,null);
  assert.equal(failed.summary.attributedEvidenceCount,null);
  assert.equal(failed.summary.lastNewEvidenceAt,null);
  assert.equal(failed.summary.stopConditionProgress.satisfied,null);
});
