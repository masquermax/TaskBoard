import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SourceTraceVerifier } from '../src/governance/source-trace-verifier.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';

function projectEvidence(id,overrides={}){return{id,strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'TARGET = true',basis:'target.js#L1',locator:'target.js#L1',observation:'TARGET = true',...overrides};}
function claim(id,evidenceIds,level='confirmed'){return{id,statement:'目标已经确定',level,evidenceIds,scope:'single_system',coverage:'component',hops:[]};}
function decision(overrides={}){return{kind:'complete',summary:'done',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[],...overrides};}

test('Validator source ledger keeps exact project-file Evidence DIRECT when the invoice matches the source',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-ledger-'));
  try{writeFileSync(join(dir,'target.js'),'TARGET = true\n');const out=new SourceTraceVerifier().enforce({task:{id:'T',projectScopes:[{path:dir}],attachments:[],references:[]},evidence:[projectEvidence('E-1')]});assert.equal(out.evidence.length,1);assert.equal(out.evidence[0].strength,'direct');assert.equal(out.verifications[0].verified,true);assert.equal(out.actions.length,0);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Validator rejects a fabricated or mismatched source instead of keeping it as weak Evidence',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-reject-'));
  try{
    writeFileSync(join(dir,'target.js'),'TARGET = false\n');const verifier=new SourceTraceVerifier(),task={id:'T',projectScopes:[{path:dir}],attachments:[],references:[]};
    const missing=verifier.enforce({task,evidence:[projectEvidence('E-MISSING',{locator:'missing.js#L1'})]});assert.deepEqual(missing.evidence,[]);assert.equal(missing.actions[0].action,'REJECT_UNTRACEABLE_SOURCE');
    const mismatch=verifier.enforce({task,evidence:[projectEvidence('E-MISMATCH')]});assert.deepEqual(mismatch.evidence,[]);assert.equal(mismatch.actions[0].action,'REJECT_UNTRACEABLE_SOURCE');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('A real source that cannot be verified stays INDIRECT and Root may only keep a downgraded conclusion',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-indirect-'));
  try{
    writeFileSync(join(dir,'target.js'),'TARGET = true\n');
    const task={id:'T',projectScopes:[{path:dir}],attachments:[],references:[]};
    const indirect=projectEvidence('E-I',{strength:'indirect',statement:'可能与目标有关',observation:'模型转述而非原文'});
    const runtime=new ValidatorRuntime();
    const accepted=runtime.reviewRoot({task,availableEvidence:[indirect],decision:decision({claims:[claim('C-I',['E-I'],'supported')]})});
    assert.equal(accepted.outcome,'pass');
    assert.equal(accepted.decision.evidence[0].strength,'indirect');
    const escalated=runtime.reviewRoot({task,availableEvidence:[indirect],decision:decision({claims:[claim('C-BAD',['E-I'],'confirmed')]})});
    assert.equal(escalated.outcome,'reject');
    assert.ok(escalated.feedback.some(item=>item.action==='REJECT_TRUST_ESCALATION'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Visual attachment provenance is accepted only as INDIRECT because Validator does not interpret pixels',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-visual-'));
  try{const image=join(dir,'screen.png');writeFileSync(image,Buffer.from([1,2,3]));const out=new SourceTraceVerifier().enforce({task:{id:'T',projectScopes:[],attachments:[{id:'A-1',name:'screen.png',mimeType:'image/png',path:image}],references:[]},evidence:[{id:'E-V',strength:'direct',kind:'fact',sourceType:'attachment_visual',coverage:'source',statement:'按钮是红色',basis:'screen.png',locator:'screen.png',observation:'按钮是红色'}]});assert.equal(out.evidence[0].strength,'indirect');assert.equal(out.actions[0].action,'DOWNGRADE_UNVERIFIED_SOURCE_TRACE');}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Agent-authored search/runtime prose has no invoice until TaskBoard owns a replayable source record',()=>{
  const verifier=new SourceTraceVerifier(),task={id:'T',projectScopes:[],attachments:[],references:[],instruction:'x'};
  for(const sourceType of ['project_search','runtime']){const out=verifier.enforce({task,evidence:[{id:`E-${sourceType}`,strength:'direct',kind:'fact',sourceType,coverage:'project',statement:'未找到实现',basis:'agent',locator:'search://query',observation:'未找到实现'}]});assert.deepEqual(out.evidence,[]);assert.ok(out.actions.some(action=>action.action==='REJECT_UNTRACEABLE_SOURCE'));}
});

test('Validator rejects a Claim whose cited invoice is missing and never repairs or re-asks Root',()=>{
  const runtime=new ValidatorRuntime({sourceTraceVerifier:{enforce:()=>({evidence:[],actions:[],verifications:[]})}});
  const out=runtime.reviewRoot({decision:decision({claims:[claim('C-MISSING',['E-NOT-THERE'],'confirmed')]}),task:{id:'T'}});
  assert.equal(out.outcome,'reject');
  assert.ok(out.feedback.some(item=>String(item.reason).includes('E-NOT-THERE')));
  assert.equal(typeof runtime.makeSafeRootResult,'undefined');
  assert.equal(typeof runtime.deriveNewRootProgress,'undefined');
  assert.equal(typeof runtime.semanticReviewRoot,'undefined');
  assert.equal('analysisValidator' in runtime,false);
  assert.equal('semanticVerifier' in runtime,false);
});
