import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkUnitObservability } from '../src/core/work-unit-observability.js';

function command(id,command,output,durationMs=20){return{id,type:'commandExecution',command,cwd:'C:/repo',aggregatedOutput:output,status:'completed',exitCode:0,durationMs};}

test('Work Unit observability records actual tool duration and operation class only',()=>{
  const base=Date.parse('2026-08-19T00:00:00.000Z'),emitted=[];
  const observer=new WorkUnitObservability({taskId:'T',workUnitId:'W',turnId:'turn-1',startedAt:base,emitDiagnostic:(event,data,level)=>emitted.push({event,level,...data})});
  observer.start({id:'a',type:'commandExecution',command:'rg "Authority" src/core',cwd:'C:/repo'},base+1000);
  observer.complete(command('a','rg "Authority" src/core','match',800),base+1800);
  observer.start({id:'b',type:'commandExecution',command:'Get-Content src/core/root-runtime.js',cwd:'C:/repo'},base+2000);
  observer.complete(command('b','Get-Content src/core/root-runtime.js','body',600),base+2600);
  const finalized=observer.finalize({evidence:[{id:'E-1'}],completedAt:base+3000,status:'completed'});
  assert.equal(finalized.summary.durationMs,3000);
  assert.equal(finalized.summary.toolCallCount,2);
  assert.deepEqual(finalized.summary.operationCounts,{search:1,read:1});
  assert.equal(finalized.summary.evidenceCount,1);
  assert.equal(emitted.length,2);
  assert.equal(emitted[0].event,'tool-completed');
  assert.equal(emitted[0].toolCallName,'rg');
  assert.equal(emitted[0].operationClass,'search');
  assert.equal(emitted[0].durationMs,800);
});

test('failed Work Unit keeps timing and blocker without inventing semantic progress',()=>{
  const base=Date.parse('2026-08-19T00:00:00.000Z'),observer=new WorkUnitObservability({taskId:'T',workUnitId:'W',startedAt:base});
  const result=observer.finalize({evidence:null,completedAt:base+5000,status:'failed',blocker:'parse failed'});
  assert.equal(result.summary.durationMs,5000);
  assert.equal(result.summary.toolCallCount,0);
  assert.equal(result.summary.evidenceCount,null);
  assert.equal(result.summary.blocker,'parse failed');
  assert.equal('postSaturationCalls' in result.summary,false);
  assert.equal('convergenceSteerAt' in result.summary,false);
});
