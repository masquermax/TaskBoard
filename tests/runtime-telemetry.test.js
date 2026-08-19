import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { InstrumentedRootRuntime, instrumentExecutorTelemetry, rootPromptComponents, validatorPromptComponents } from '../src/core/runtime-telemetry.js';

function task(){
  return{
    id:'T-TELEMETRY',
    title:'Telemetry',
    instruction:'Inspect runtime without changing code.',
    references:[{source_task_id:'T-OLD',title:'Old',final_result:'done'}],
    workReceipts:[{id:'WU-1',workUnit:{title:'Read',goal:'Inspect',inputRefs:[],projectAccess:'read',networkAccess:false},completed_at:'2026-01-01T00:00:00.000Z'}],
    last_stage_result:'stage-result',
    taskContract:{obligations:[{id:'O-1'},{id:'O-2'}]},
  };
}

test('root prompt telemetry measures available payloads without requiring missing fields',()=>{
  const request={
    task:task(),
    subagentResults:[{delegationId:'WU-1',result:'evidence'}],
    activeWork:[],
    policyContext:{prompt:'policy',skillCatalog:[{id:'S-1'}]},
    certifiedContext:{evidence:[{id:'E-1'}],claims:[{id:'C-1'}],gaps:[{id:'G-1'}]},
    validationFeedback:null,
    previousDecision:null,
  };
  const result=rootPromptComponents(request,'complete prompt');
  assert.ok(result.taskInstructionBytes>0);
  assert.ok(result.workReceiptsBytes>0);
  assert.ok(result.newWorkResultsBytes>0);
  assert.ok(result.certifiedEvidenceBytes>0);
  assert.ok(result.certifiedClaimsBytes>0);
  assert.ok(result.certifiedGapsBytes>0);
  assert.equal(result.validatorFeedbackBytes,2); // [] JSON payload when absent
  assert.equal(result.totalPromptBytes,Buffer.byteLength('complete prompt','utf8'));
});

test('completion validator telemetry exposes logical proof material and repeated prompt cost',()=>{
  const proofMaterial=[{id:'E-1',kind:'project_file'},{id:'C-1',level:'confirmed',evidenceIds:['E-1']}];
  const proposal={finalResult:'NOT READY'};
  const candidates=[1,2].map(index=>({
    id:`completion:O-${index}`,
    candidateType:'completion_assessment',
    proofMaterial,
    requirementContext:[{sourceId:'R-1',text:'criterion'}],
    proposal,
  }));
  const result=validatorPromptComponents({task:task(),candidates},'validator prompt');
  assert.equal(result.validatorKind,'completion');
  assert.equal(result.obligationCount,2);
  assert.equal(result.completionCandidateCount,2);
  assert.equal(result.proofMaterialEvidenceCount,1);
  assert.equal(result.proofMaterialClaimCount,1);
  assert.ok(result.proofMaterialRepeatedBytes>result.proofMaterialBytes);
  assert.ok(result.proposalRepeatedBytes>result.proposalBytes);
  assert.equal(result.totalValidatorBytes,Buffer.byteLength('validator prompt','utf8'));
});

test('executor prompt wrappers emit detailed telemetry only in debug mode and never block prompt return',()=>{
  const previous=process.env.TASKBOARD_LOG_LEVEL;
  const originalLog=console.log;
  const lines=[];
  console.log=line=>lines.push(String(line));
  try{
    const executor={
      rootPrompt(){return'ROOT PROMPT';},
      validatorPrompt(){return'VALIDATOR PROMPT';},
    };
    instrumentExecutorTelemetry(executor);
    executor.setRootTelemetryContext('T-TELEMETRY',{rootTurn:7,activityKind:'completion_repair'});

    process.env.TASKBOARD_LOG_LEVEL='info';
    assert.equal(executor.rootPrompt({task:task(),certifiedContext:{}}),'ROOT PROMPT');
    assert.equal(lines.length,0);

    process.env.TASKBOARD_LOG_LEVEL='debug';
    executor.setRootTelemetryContext('T-TELEMETRY',{rootTurn:7,activityKind:'completion_repair'});
    assert.equal(executor.rootPrompt({task:task(),certifiedContext:{}}),'ROOT PROMPT');
    assert.equal(executor.validatorPrompt({task:task(),candidates:[]}),'VALIDATOR PROMPT');
    assert.equal(lines.length,2);
    assert.match(lines[0],/"event":"root-prompt-components"/);
    assert.match(lines[0],/"rootTurn":7/);
    assert.match(lines[1],/"event":"validator-prompt-components"/);
  }finally{
    console.log=originalLog;
    if(previous==null)delete process.env.TASKBOARD_LOG_LEVEL;else process.env.TASKBOARD_LOG_LEVEL=previous;
  }
});

test('instrumented Root emits context and certified delta outcome without changing Root control result',async()=>{
  const previousLevel=process.env.TASKBOARD_LOG_LEVEL;
  const originalLog=console.log;
  const originalRun=RootRuntime.prototype.runRootTurn;
  const originalReview=RootRuntime.prototype.reviewRootDecision;
  const lines=[];
  console.log=line=>lines.push(String(line));
  process.env.TASKBOARD_LOG_LEVEL='debug';
  RootRuntime.prototype.runRootTurn=async function(_task,session){session.rootTurnCount+=1;return{kind:'delegate',delegations:[{id:'WU-NEXT'}]};};
  RootRuntime.prototype.reviewRootDecision=async function(){return{decision:{kind:'delegate',delegations:[{id:'WU-NEXT'}]},turnNode:{delta:{evidence:[{id:'E-2'}],claims:[{id:'C-2'}],gaps:[],gapResolutions:[]}},requiresRootDecision:false};};
  try{
    const runtime=new InstrumentedRootRuntime({executor:{setRootTelemetryContext(){}},modelRouter:null,subagentRuntime:null,completionEvaluator:null});
    const session={
      rootTurnCount:0,
      certifiedContext:{evidence:[{id:'E-1'}],claims:[{id:'C-1'}],gaps:[{id:'G-1'}]},
      analysisState:{version:12,current:{evidence:[{id:'E-1'}],claims:[{id:'C-1'}],gaps:[{id:'G-1'}]}},
      completionTriggerRefs:[],planningTriggerRefs:[],
    };
    const rootResult=await runtime.runRootTurn(task(),session,{}, {activityKind:'synthesis',rootInputs:[{delegationId:'WU-1'}]});
    const reviewed=await runtime.reviewRootDecision(task(),session,rootResult,{}, {rootInputs:[{delegationId:'WU-1'}],triggerRefs:['work:WU-1']});
    assert.equal(reviewed.decision.kind,'delegate');
    const contextLine=lines.find(line=>line.includes('"event":"root-turn-context"'));
    const outcomeLine=lines.find(line=>line.includes('"event":"root-turn-outcome"'));
    assert.ok(contextLine);
    assert.ok(outcomeLine);
    assert.match(contextLine,/"rootTurn":1/);
    assert.match(contextLine,/"triggerType":"work_results"/);
    assert.match(contextLine,/"certifiedStateVersion":12/);
    assert.match(outcomeLine,/"newCertifiedEvidence":1/);
    assert.match(outcomeLine,/"newCertifiedClaims":1/);
    assert.match(outcomeLine,/"nextTurnReason":"delegation_validation"/);
  }finally{
    RootRuntime.prototype.runRootTurn=originalRun;
    RootRuntime.prototype.reviewRootDecision=originalReview;
    console.log=originalLog;
    if(previousLevel==null)delete process.env.TASKBOARD_LOG_LEVEL;else process.env.TASKBOARD_LOG_LEVEL=previousLevel;
  }
});
