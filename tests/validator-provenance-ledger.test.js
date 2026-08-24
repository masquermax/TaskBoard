import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SourceTraceVerifier } from '../src/governance/source-trace-verifier.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';

function projectEvidence(id,overrides={}){return{id,strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'TARGET = true',basis:'target.js#L1',locator:'target.js#L1',observation:'TARGET = true',...overrides};}
function claim(id,evidenceIds,level='confirmed'){return{id,statement:'目标已经确定',level,evidenceIds,scope:'single_system',coverage:'component',hops:[]};}
function decision(overrides={}){return{kind:'complete',summary:'done',finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[],...overrides};}

test('matching project-file invoice stays DIRECT',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-ledger-'));
  try{writeFileSync(join(dir,'target.js'),'TARGET = true\n');const out=new SourceTraceVerifier().enforce({task:{id:'T',projectScopes:[{path:dir}],attachments:[],references:[]},evidence:[projectEvidence('E-1')]});assert.equal(out.evidence.length,1);assert.equal(out.evidence[0].strength,'direct');assert.equal(out.verifications[0].verified,true);assert.equal(out.actions.length,0);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('fabricated or mismatched source is rejected',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-reject-'));
  try{writeFileSync(join(dir,'target.js'),'TARGET = false\n');const verifier=new SourceTraceVerifier(),task={id:'T',projectScopes:[{path:dir}],attachments:[],references:[]};const missing=verifier.enforce({task,evidence:[projectEvidence('E-MISSING',{locator:'missing.js#L1'})]});assert.deepEqual(missing.evidence,[]);assert.equal(missing.actions[0].action,'REJECT_UNTRACEABLE_SOURCE');const mismatch=verifier.enforce({task,evidence:[projectEvidence('E-MISMATCH')]});assert.deepEqual(mismatch.evidence,[]);assert.equal(mismatch.actions[0].action,'REJECT_UNTRACEABLE_SOURCE');}finally{rmSync(dir,{recursive:true,force:true});}
});

test('INDIRECT source cannot be upgraded to CONFIRMED',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-indirect-'));
  try{writeFileSync(join(dir,'target.js'),'TARGET = true\n');const task={id:'T',projectScopes:[{path:dir}],attachments:[],references:[]},indirect=projectEvidence('E-I',{strength:'indirect',statement:'可能与目标有关',observation:'模型转述而非原文'}),runtime=new ValidatorRuntime();const accepted=runtime.reviewRoot({task,availableEvidence:[indirect],decision:decision({claims:[claim('C-I',['E-I'],'supported')]})});assert.equal(accepted.outcome,'pass');assert.equal(accepted.decision.evidence[0].strength,'indirect');const escalated=runtime.reviewRoot({task,availableEvidence:[indirect],decision:decision({claims:[claim('C-BAD',['E-I'],'confirmed')]})});assert.equal(escalated.outcome,'reject');assert.ok(escalated.feedback.some(item=>item.action==='REJECT_TRUST_ESCALATION'));}finally{rmSync(dir,{recursive:true,force:true});}
});

test('visual attachment is provenance-only and therefore INDIRECT',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-visual-'));
  try{const image=join(dir,'screen.png');writeFileSync(image,Buffer.from([1,2,3]));const out=new SourceTraceVerifier().enforce({task:{id:'T',projectScopes:[],attachments:[{id:'A-1',name:'screen.png',mimeType:'image/png',path:image}],references:[]},evidence:[{id:'E-V',strength:'direct',kind:'fact',sourceType:'attachment_visual',coverage:'source',statement:'按钮是红色',basis:'screen.png',locator:'screen.png',observation:'按钮是红色'}]});assert.equal(out.evidence[0].strength,'indirect');assert.equal(out.actions[0].action,'DOWNGRADE_UNVERIFIED_SOURCE_TRACE');}finally{rmSync(dir,{recursive:true,force:true});}
});

test('agent-authored search/runtime prose has no invoice without a replayable source record',()=>{
  const verifier=new SourceTraceVerifier(),task={id:'T',projectScopes:[],attachments:[],references:[],instruction:'x'};
  for(const sourceType of ['project_search','runtime']){const out=verifier.enforce({task,evidence:[{id:`E-${sourceType}`,strength:'direct',kind:'fact',sourceType,coverage:'project',statement:'未找到实现',basis:'agent',locator:'search://query',observation:'未找到实现'}]});assert.deepEqual(out.evidence,[]);assert.ok(out.actions.some(action=>action.action==='REJECT_UNTRACEABLE_SOURCE'));}
});

test('Validator rejects missing invoices and owns no semantic repair path',()=>{
  const runtime=new ValidatorRuntime({sourceTraceVerifier:{enforce:()=>({evidence:[],actions:[],verifications:[]})}}),out=runtime.reviewRoot({decision:decision({claims:[claim('C-MISSING',['E-NOT-THERE'],'confirmed')]}),task:{id:'T'}});
  assert.equal(out.outcome,'reject');assert.ok(out.feedback.some(item=>String(item.reason).includes('E-NOT-THERE')));assert.equal(typeof runtime.makeSafeRootResult,'undefined');assert.equal(typeof runtime.deriveNewRootProgress,'undefined');assert.equal(typeof runtime.semanticReviewRoot,'undefined');assert.equal('analysisValidator' in runtime,false);assert.equal('semanticVerifier' in runtime,false);
});

test('Gap resolution requires an admitted DIRECT invoice even when an Executor bypasses the JSON schema',()=>{
  const runtime=new ValidatorRuntime({sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:[]})}}),currentState={version:1,current:{evidence:[],claims:[],gaps:[{id:'G-1',question:'还缺什么？',reason:'缺事实',kind:'missing_fact',blocking:true,evidenceIds:[]}],recommendations:[],steps:[]}};
  const missing=runtime.reviewRoot({task:{id:'T'},currentState,decision:decision({gapResolutions:[{gapId:'G-1',reason:'直接关闭',evidenceIds:[]}]})});
  assert.equal(missing.outcome,'reject');assert.ok(missing.feedback.some(item=>item.target==='gap:G-1'&&item.action==='REJECT_TRUST_ESCALATION'));
  const indirect={id:'E-I',strength:'indirect',kind:'fact',sourceType:'reference',coverage:'source',statement:'参考说已解决',basis:'ref',locator:'ref',observation:'参考说已解决'},weak=runtime.reviewRoot({task:{id:'T'},currentState,decision:decision({evidence:[indirect],gapResolutions:[{gapId:'G-1',reason:'参考关闭',evidenceIds:['E-I']}]})});
  assert.equal(weak.outcome,'reject');
  const direct={...indirect,id:'E-D',strength:'direct',sourceType:'human'},strong=runtime.reviewRoot({task:{id:'T'},currentState,humanGatewayHistory:[],decision:decision({evidence:[direct],gapResolutions:[{gapId:'G-1',reason:'直接证据关闭',evidenceIds:['E-D']}]})});
  assert.equal(strong.outcome,'pass');
});

test('confirmed presentation Step cannot cite a merely SUPPORTED Claim',()=>{
  const runtime=new ValidatorRuntime({sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:[]})}}),direct={id:'E-D',strength:'direct',kind:'fact',sourceType:'human',coverage:'source',statement:'已观察',basis:'human',locator:'human',observation:'已观察'};
  const supported=runtime.reviewRoot({task:{id:'T'},decision:decision({evidence:[direct],claims:[claim('C-S',['E-D'],'supported')],steps:[{order:1,text:'作为已确认步骤展示',kind:'confirmed',sourceIds:['C-S']}]})});
  assert.equal(supported.outcome,'reject');assert.ok(supported.feedback.some(item=>item.target==='step:1'&&item.action==='REJECT_TRUST_ESCALATION'));
  const confirmed=runtime.reviewRoot({task:{id:'T'},decision:decision({evidence:[direct],claims:[claim('C-C',['E-D'],'confirmed')],steps:[{order:1,text:'确认步骤',kind:'confirmed',sourceIds:['C-C']}]})});
  assert.equal(confirmed.outcome,'pass');
});
