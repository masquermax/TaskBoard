import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SourceTraceVerifier } from '../src/governance/source-trace-verifier.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';

function projectEvidence(id,overrides={}){
  return{
    id,
    strength:'direct',
    kind:'fact',
    sourceType:'project_file',
    coverage:'component',
    statement:'TARGET = true',
    basis:'target.js#L1',
    locator:'target.js#L1',
    observation:'TARGET = true',
    ...overrides,
  };
}

function decision(overrides={}){
  return{
    kind:'complete',summary:'done',stageResult:null,finalResult:null,resultMode:'analysis',
    evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[],
    ...overrides,
  };
}

test('Validator source ledger keeps exact project-file Evidence DIRECT when the invoice matches the source',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-ledger-'));
  try{
    writeFileSync(join(dir,'target.js'),'TARGET = true\n');
    const verifier=new SourceTraceVerifier();
    const out=verifier.enforce({task:{id:'T',projectScopes:[{path:dir}],attachments:[],references:[]},evidence:[projectEvidence('E-1')]});
    assert.equal(out.evidence.length,1);
    assert.equal(out.evidence[0].strength,'direct');
    assert.equal(out.verifications[0].verified,true);
    assert.equal(out.actions.length,0);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Validator rejects a fabricated or mismatched source instead of keeping it as weak Evidence',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-reject-'));
  try{
    writeFileSync(join(dir,'target.js'),'TARGET = false\n');
    const verifier=new SourceTraceVerifier();
    const missing=verifier.enforce({task:{id:'T',projectScopes:[{path:dir}],attachments:[],references:[]},evidence:[projectEvidence('E-MISSING',{locator:'missing.js#L1'})]});
    assert.deepEqual(missing.evidence,[]);
    assert.equal(missing.actions[0].action,'REJECT_UNTRACEABLE_SOURCE');

    const mismatch=verifier.enforce({task:{id:'T',projectScopes:[{path:dir}],attachments:[],references:[]},evidence:[projectEvidence('E-MISMATCH')]});
    assert.deepEqual(mismatch.evidence,[]);
    assert.equal(mismatch.actions[0].action,'REJECT_UNTRACEABLE_SOURCE');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('A real source that is intentionally INDIRECT stays usable only as untrusted reference material',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-indirect-'));
  try{
    writeFileSync(join(dir,'target.js'),'TARGET = true\n');
    const verifier=new SourceTraceVerifier();
    const out=verifier.enforce({
      task:{id:'T',projectScopes:[{path:dir}],attachments:[],references:[]},
      evidence:[projectEvidence('E-I',{strength:'indirect',statement:'可能与目标有关',observation:'模型转述而非原文'})],
    });
    assert.equal(out.evidence.length,1);
    assert.equal(out.evidence[0].strength,'indirect');
    assert.equal(out.verifications[0].traceable,true);
    assert.equal(out.verifications[0].verified,false);
    assert.equal(out.actions[0].action,'DOWNGRADE_UNVERIFIED_SOURCE_TRACE');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Visual attachment provenance is accepted only as INDIRECT because Validator does not interpret pixels',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-visual-'));
  try{
    const image=join(dir,'screen.png');writeFileSync(image,Buffer.from([1,2,3]));
    const verifier=new SourceTraceVerifier();
    const out=verifier.enforce({
      task:{id:'T',projectScopes:[],attachments:[{id:'A-1',name:'screen.png',mimeType:'image/png',path:image}],references:[]},
      evidence:[{id:'E-V',strength:'direct',kind:'fact',sourceType:'attachment_visual',coverage:'source',statement:'按钮是红色',basis:'screen.png',locator:'screen.png',observation:'按钮是红色'}],
    });
    assert.equal(out.evidence.length,1);
    assert.equal(out.evidence[0].strength,'indirect');
    assert.equal(out.actions[0].action,'DOWNGRADE_UNVERIFIED_SOURCE_TRACE');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Agent-authored search/runtime prose has no invoice until TaskBoard owns a replayable source record',()=>{
  const verifier=new SourceTraceVerifier();
  const task={id:'T',projectScopes:[],attachments:[],references:[],instruction:'x'};
  for(const sourceType of ['project_search','runtime']){
    const out=verifier.enforce({task,evidence:[{id:`E-${sourceType}`,strength:'direct',kind:'fact',sourceType,coverage:'project',statement:'未找到实现',basis:'agent',locator:'search://query',observation:'未找到实现'}]});
    assert.deepEqual(out.evidence,[]);
    assert.ok(out.actions.some(action=>action.action==='REJECT_UNTRACEABLE_SOURCE'));
  }
});

test('Validator semantic compatibility hook never calls a model or rethinks the Root conclusion',async()=>{
  let semanticCalls=0;
  const runtime=new ValidatorRuntime({
    analysisValidator:new AnalysisResultValidator(),
    semanticVerifier:{async review(){semanticCalls+=1;throw new Error('MODEL_MUST_NOT_RUN');}},
  });
  const reviewed={outcome:'pass',decision:decision(),feedback:[],actions:[],commits:[],observedKnowledgeKeys:[]};
  const result=await runtime.semanticReviewRoot({reviewed,task:{id:'T'}});
  assert.equal(result,reviewed);
  assert.equal(semanticCalls,0);
});

test('Deterministic Validator narrowing never requests a Root rewrite turn for the same evidence',()=>{
  const runtime=new ValidatorRuntime({
    analysisValidator:new AnalysisResultValidator(),
    sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:evidence.map(item=>({id:item.id,checked:true,verified:false,traceable:true}))})},
  });
  const indirect=projectEvidence('E-I',{strength:'indirect'});
  const proposed=decision({claims:[{id:'C-1',statement:'目标已经确定',level:'confirmed',evidenceIds:['E-I'],scope:'single_system',coverage:'component',hops:[]}]});
  const result=runtime.reviewRoot({decision:proposed,availableEvidence:[indirect],task:{id:'T'},currentState:null,seenKnowledgeKeys:new Set()});
  assert.notEqual(result.outcome,'rework');
});
