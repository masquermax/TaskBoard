import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { InstrumentedRootRuntime, instrumentExecutorTelemetry, rootPromptComponents } from '../src/core/runtime-telemetry.js';

function task(){
  return{
    id:'T-TELEMETRY',
    title:'Telemetry',
    instruction:'Inspect runtime without changing code.',
    references:[{source_task_id:'T-OLD',title:'Old',final_result:'done'}],
    workReceipts:[{id:'WU-1',workUnit:{title:'Read',goal:'Inspect',inputRefs:[],projectAccess:'read',networkAccess:false},completed_at:'2026-01-01T00:00:00.000Z'}],
    last_stage_result:'stage-result',
  };
}

test('root prompt telemetry keeps only current skeleton payload costs',()=>{
  const request={task:task(),subagentResults:[{delegationId:'WU-1',result:'evidence'}],activeWork:[],policyContext:{prompt:'policy',skillCatalog:[{id:'S-1'}]},certifiedContext:{evidence:[{id:'E-1'}],claims:[{id:'C-1'}],gaps:[{id:'G-1'}]}};
  const result=rootPromptComponents(request,'complete prompt');
  assert.ok(result.taskInstructionBytes>0);assert.ok(result.workReceiptsBytes>0);assert.ok(result.newWorkResultsBytes>0);assert.ok(result.certifiedEvidenceBytes>0);assert.ok(result.certifiedClaimsBytes>0);assert.ok(result.certifiedGapsBytes>0);
  assert.equal('validatorFeedbackBytes' in result,false);assert.equal('previousCandidateBytes' in result,false);assert.equal('planningFeedbackBytes' in result,false);
  assert.equal(result.totalPromptBytes,Buffer.byteLength('complete prompt','utf8'));
});

test('executor wrapper emits Root prompt size telemetry only in debug mode',()=>{
  const previous=process.env.TASKBOARD_LOG_LEVEL,originalLog=console.log,lines=[];console.log=line=>lines.push(String(line));
  try{
    const executor={rootPrompt(){return'ROOT PROMPT';},validatorPrompt(){return'VALIDATOR PROMPT';}};
    instrumentExecutorTelemetry(executor);
    process.env.TASKBOARD_LOG_LEVEL='info';executor.setRootTelemetryContext('T-TELEMETRY',{rootTurn:7,activityKind:'synthesis'});assert.equal(executor.rootPrompt({task:task(),certifiedContext:{}}),'ROOT PROMPT');assert.equal(lines.length,0);
    process.env.TASKBOARD_LOG_LEVEL='debug';executor.setRootTelemetryContext('T-TELEMETRY',{rootTurn:7,activityKind:'synthesis'});assert.equal(executor.rootPrompt({task:task(),certifiedContext:{}}),'ROOT PROMPT');assert.equal(executor.validatorPrompt({task:task(),candidates:[]}),'VALIDATOR PROMPT');
    assert.equal(lines.length,1,'Validator has no model-prompt telemetry because Validator has no model turn');assert.match(lines[0],/"event":"root-prompt-components"/);assert.match(lines[0],/"rootTurn":7/);
  }finally{console.log=originalLog;if(previous==null)delete process.env.TASKBOARD_LOG_LEVEL;else process.env.TASKBOARD_LOG_LEVEL=previous;}
});

test('instrumented Root emits one context and one outcome per actual Root turn',async()=>{
  const previousLevel=process.env.TASKBOARD_LOG_LEVEL,originalLog=console.log,originalRun=RootRuntime.prototype.runRootTurn,originalReview=RootRuntime.prototype.reviewRootDecision,lines=[];
  console.log=line=>lines.push(String(line));process.env.TASKBOARD_LOG_LEVEL='debug';
  RootRuntime.prototype.runRootTurn=async function(_task,session){session.rootTurnCount+=1;return{kind:'delegate',delegations:[{id:'WU-NEXT'}]};};
  RootRuntime.prototype.reviewRootDecision=async function(){return{decision:{kind:'delegate',delegations:[{id:'WU-NEXT'}]},turnNode:{delta:{evidence:[{id:'E-2'}],claims:[{id:'C-2'}],gaps:[],gapResolutions:[]}}};};
  try{
    const runtime=new InstrumentedRootRuntime({executor:{setRootTelemetryContext(){}},modelRouter:null,subagentRuntime:null,completionEvaluator:null});
    const session={rootTurnCount:0,certifiedContext:{evidence:[{id:'E-1'}],claims:[{id:'C-1'}],gaps:[{id:'G-1'}]},analysisState:{version:12,current:{evidence:[{id:'E-1'}],claims:[{id:'C-1'}],gaps:[{id:'G-1'}]}}};
    const rootResult=await runtime.runRootTurn(task(),session,{}, {activityKind:'synthesis',rootInputs:[{delegationId:'WU-1'}]});
    const reviewed=await runtime.reviewRootDecision(task(),session,rootResult,{}, {rootInputs:[{delegationId:'WU-1'}],triggerRefs:['work:WU-1']});
    assert.equal(reviewed.decision.kind,'delegate');
    const contextLine=lines.find(line=>line.includes('"event":"root-turn-context"')),outcomeLine=lines.find(line=>line.includes('"event":"root-turn-outcome"'));
    assert.ok(contextLine);assert.ok(outcomeLine);assert.match(contextLine,/"rootTurn":1/);assert.match(contextLine,/"triggerType":"work_results"/);assert.match(contextLine,/"certifiedStateVersion":12/);assert.match(outcomeLine,/"newCertifiedEvidence":1/);assert.match(outcomeLine,/"newCertifiedClaims":1/);assert.match(outcomeLine,/"nextTurnReason":"work_stage"/);
    assert.equal(lines.filter(line=>line.includes('"event":"root-turn-outcome"')).length,1);
  }finally{RootRuntime.prototype.runRootTurn=originalRun;RootRuntime.prototype.reviewRootDecision=originalReview;console.log=originalLog;if(previousLevel==null)delete process.env.TASKBOARD_LOG_LEVEL;else process.env.TASKBOARD_LOG_LEVEL=previousLevel;}
});
