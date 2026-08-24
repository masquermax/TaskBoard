import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { SourceTraceVerifier } from '../src/governance/source-trace-verifier.js';

function analysis(evidence,claim){return{kind:'complete',summary:'x',finalResult:null,resultMode:'analysis',evidence:evidence?[evidence]:[],claims:claim?[claim]:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};}

test('Validator rejects project-file DIRECT Evidence when the cited observation is not in the source',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-trace-'));mkdirSync(join(dir,'src'));
  writeFileSync(join(dir,'src','Example.java'),'void f(){\n  ATTRIBUTE1 = person.getFdNo();\n}\n','utf8');
  const task={id:'T',title:'OA需求分析',instruction:'根据项目核对',projectScopes:[{path:dir}],attachments:[],references:[]};
  const validator=new ValidatorRuntime();
  try{
    const source={id:'E-1',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'申请人工号写入 ATTRIBUTE1',basis:'Example.java',locator:'src/Example.java#L1-L3',observation:'申请人工号写入 ATTRIBUTE1'};
    const reviewed=validator.reviewRoot({task,availableEvidence:[source],decision:analysis(
      null,
      {id:'C-1',statement:'申请人工号写入 ATTRIBUTE1。',level:'confirmed',evidenceIds:['E-1'],scope:'single_system',coverage:'component',hops:[]}
    )});
    assert.equal(reviewed.outcome,'reject');
    assert.deepEqual(reviewed.decision.evidence,[],'a fake/mismatched invoice does not survive as weak Evidence');
    assert.ok(reviewed.actions.some(a=>a.action==='REJECT_UNTRACEABLE_SOURCE'));
    assert.ok(reviewed.feedback.some(item=>item.action==='REJECT_UNTRACEABLE_SOURCE'));
    assert.deepEqual(reviewed.decision.gaps,[],'Validator must not manufacture a semantic repair Gap');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Validator keeps project-file DIRECT Evidence when its raw observation exists at the traceable address',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-trace-ok-'));mkdirSync(join(dir,'src'));
  writeFileSync(join(dir,'src','Example.java'),'ATTRIBUTE1 = person.getFdNo();\n','utf8');
  const task={id:'T',title:'OA需求分析',instruction:'根据项目核对',projectScopes:[{path:dir}],attachments:[],references:[]};
  const validator=new ValidatorRuntime();
  try{
    const source={id:'E-1',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'ATTRIBUTE1 = person.getFdNo();',basis:'Example.java',locator:'src/Example.java:1',observation:'ATTRIBUTE1 = person.getFdNo();'};
    const reviewed=validator.reviewRoot({task,availableEvidence:[source],decision:analysis(
      null,
      {id:'C-1',statement:'当前组件把所选 person 的 fdNo 写入 ATTRIBUTE1。',level:'confirmed',evidenceIds:['E-1'],scope:'single_system',coverage:'component',hops:[]}
    )});
    assert.equal(reviewed.outcome,'pass');
    assert.equal(reviewed.decision.evidence[0].strength,'direct');
    assert.equal(reviewed.decision.claims[0].level,'confirmed');
    assert.equal(reviewed.actions.some(a=>a.action==='REJECT_UNTRACEABLE_SOURCE'),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('traceable line address must match the cited line range, not merely the same text elsewhere in the file',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-line-'));mkdirSync(join(dir,'src'));
  writeFileSync(join(dir,'src','Example.java'),'TARGET();\nOTHER();\nTARGET();\n','utf8');
  const task={id:'T',projectScopes:[{path:dir}],attachments:[],references:[],instruction:'x'};
  const verifier=new SourceTraceVerifier();
  try{
    const out=verifier.enforce({task,evidence:[{id:'E-L',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'TARGET();',basis:'Example.java',locator:'src/Example.java#L2',observation:'TARGET();'}]});
    assert.deepEqual(out.evidence,[]);
    assert.equal(out.actions[0].action,'REJECT_UNTRACEABLE_SOURCE');
    assert.match(out.actions[0].reason,/指定行范围/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('DIRECT Evidence from a real but unreadable source type is downgraded rather than invented as fact',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-binary-'));mkdirSync(join(dir,'bin'));
  writeFileSync(join(dir,'bin','payload.bin'),Buffer.from([0,1,2,3]));
  const task={id:'T',projectScopes:[{path:dir}],attachments:[],references:[],instruction:'x'};
  const verifier=new SourceTraceVerifier();
  try{
    const out=verifier.enforce({task,evidence:[{id:'E-B',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'binary means X',basis:'payload.bin',locator:'bin/payload.bin',observation:'binary means X'}]});
    assert.equal(out.evidence[0].strength,'indirect');
    assert.equal(out.verifications[0].traceable,true);
    assert.equal(out.verifications[0].verified,false);
    assert.ok(out.actions.some(action=>action.action==='DOWNGRADE_UNVERIFIED_SOURCE_TRACE'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('visual attachment keeps only real provenance and is downgraded because Validator does not interpret pixels',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-doc-visual-'));const doc=join(dir,'spec.docx');writeFileSync(doc,Buffer.from('placeholder'));
  const task={id:'T',projectScopes:[],attachments:[{id:'A-1',name:'spec.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',path:doc}],references:[],instruction:'x'};
  const verifier=new SourceTraceVerifier();
  try{
    const out=verifier.enforce({task,evidence:[{id:'E-V',strength:'direct',kind:'fact',sourceType:'attachment_visual',coverage:'source',statement:'截图内容',basis:'embedded image',locator:'spec.docx#image1.png',observation:'截图内容'}]});
    assert.equal(out.evidence[0].strength,'indirect');
    assert.equal(out.verifications[0].traceable,true);
    assert.equal(out.verifications[0].verified,false);
    assert.match(out.verifications[0].reason,/不解释像素语义/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a referenced Task result is traceable history but can never become DIRECT Evidence by quotation alone',()=>{
  const task={id:'T',projectScopes:[],attachments:[],instruction:'x',references:[{source_task_id:'T-OLD',title:'旧任务',final_result:'旧结果声称接口已经上线。'}]};
  const verifier=new SourceTraceVerifier();
  const out=verifier.enforce({task,evidence:[{id:'E-R',strength:'direct',kind:'fact',sourceType:'reference',coverage:'source',statement:'接口已经上线',basis:'T-OLD',locator:'reference:T-OLD',observation:'接口已经上线'}]});
  assert.equal(out.evidence.length,1);
  assert.equal(out.evidence[0].strength,'indirect');
  assert.equal(out.verifications[0].traceable,true);
  assert.equal(out.verifications[0].verified,false);
  assert.ok(out.actions.some(action=>action.action==='DOWNGRADE_UNVERIFIED_SOURCE_TRACE'));
});

test('project and text attachment provenance fail closed outside the owned source boundary',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-owned-'));
  const outside=mkdtempSync(join(tmpdir(),'taskboard-source-outside-'));
  const projectFile=join(dir,'facts.txt'),attachmentFile=join(dir,'attachment.txt'),outsideFile=join(outside,'facts.txt');
  writeFileSync(projectFile,'alpha fact\nbeta fact\n','utf8');
  writeFileSync(attachmentFile,'attachment truth\n','utf8');
  writeFileSync(outsideFile,'outside truth\n','utf8');
  const task={id:'T',instruction:'x',projectScopes:[{path:dir}],attachments:[{id:'A-1',name:'attachment.txt',path:attachmentFile}],references:[]};
  const verifier=new SourceTraceVerifier();
  try{
    const indirect=verifier.verifyEvidence({task,evidence:{strength:'indirect',sourceType:'project_file',locator:'facts.txt',observation:'alpha fact'}});
    assert.equal(indirect.traceable,true);assert.equal(indirect.verified,false);

    const escaped=verifier.verifyEvidence({task,evidence:{strength:'direct',sourceType:'project_file',locator:outsideFile,observation:'outside truth'}});
    assert.equal(escaped.traceable,false);

    const attachment=verifier.verifyEvidence({task,evidence:{strength:'direct',sourceType:'attachment_text',locator:'attachment.txt#L1',observation:'attachment truth'}});
    assert.equal(attachment.verified,true);

    const attachmentIndirect=verifier.verifyEvidence({task,evidence:{strength:'indirect',sourceType:'attachment_text',locator:'attachment.txt',observation:'attachment truth'}});
    assert.equal(attachmentIndirect.traceable,true);assert.equal(attachmentIndirect.verified,false);

    const missing=verifier.verifyEvidence({task:{...task,attachments:[]},evidence:{strength:'direct',sourceType:'attachment_text',locator:'missing.txt',observation:'x'}});
    assert.equal(missing.traceable,false);
  }finally{rmSync(dir,{recursive:true,force:true});rmSync(outside,{recursive:true,force:true});}
});

test('Human evidence binds only exact resolved Gateway answers or the current Task instruction',()=>{
  const task={id:'T',instruction:'用户明确要求启用审批。',projectScopes:[],attachments:[],references:[]};
  const history=[{id:'HG-1',status:'RESOLVED',question:'由谁确认？',answer:'审批必须由财务确认。',targetGapId:'G-1'}];
  const verifier=new SourceTraceVerifier();

  const gateway=verifier.verifyEvidence({task,humanGatewayHistory:history,evidence:{strength:'direct',sourceType:'human',locator:'human:HG-1',observation:'由财务确认'}});
  assert.equal(gateway.verified,true);assert.equal(gateway.gatewayId,'HG-1');assert.equal(gateway.targetGapId,'G-1');

  const gatewayMismatch=verifier.verifyEvidence({task,humanGatewayHistory:history,evidence:{strength:'direct',sourceType:'human',locator:'human:HG-1',observation:'由法务确认'}});
  assert.equal(gatewayMismatch.traceable,false);

  const gatewayIndirect=verifier.verifyEvidence({task,humanGatewayHistory:history,evidence:{strength:'indirect',sourceType:'human',locator:'human:HG-1',observation:'财务'}});
  assert.equal(gatewayIndirect.traceable,true);assert.equal(gatewayIndirect.verified,false);

  const instruction=verifier.verifyEvidence({task,evidence:{strength:'direct',sourceType:'human',locator:'task instruction',observation:'启用审批'}});
  assert.equal(instruction.verified,true);

  const instructionMismatch=verifier.verifyEvidence({task,evidence:{strength:'direct',sourceType:'human',locator:'instruction',observation:'关闭审批'}});
  assert.equal(instructionMismatch.traceable,false);

  const unrelated=verifier.verifyEvidence({task,evidence:{strength:'direct',sourceType:'human',locator:'chat memory',observation:'启用审批'}});
  assert.equal(unrelated.traceable,false);
});

test('missing provenance, unsupported transient sources, and forged trace metadata never survive enforcement',()=>{
  const verifier=new SourceTraceVerifier();
  const task={id:'T',instruction:'x',projectScopes:[],attachments:[],references:[]};

  assert.equal(verifier.verifyEvidence({}).traceable,false);
  assert.equal(verifier.verifyEvidence({task,evidence:{sourceType:'human',strength:'direct',locator:'',observation:'x'}}).traceable,false);
  assert.equal(verifier.verifyEvidence({task,evidence:{sourceType:'human',strength:'direct',locator:'instruction',observation:''}}).traceable,false);
  assert.equal(verifier.verifyEvidence({task,evidence:{sourceType:'project_search',strength:'direct',locator:'search:1',observation:'x'}}).traceable,false);
  assert.equal(verifier.verifyEvidence({task,evidence:{sourceType:'runtime',strength:'direct',locator:'runtime:1',observation:'x'}}).traceable,false);
  assert.equal(verifier.verifyEvidence({task,evidence:{sourceType:'unknown',strength:'direct',locator:'x',observation:'x'}}).traceable,false);

  const out=verifier.enforce({task,evidence:[{id:'E-FORGED',strength:'direct',sourceType:'runtime',locator:'runtime:1',observation:'x',_sourceTrace:{verified:true}}]});
  assert.deepEqual(out.evidence,[]);
  assert.equal(out.actions[0].action,'REJECT_UNTRACEABLE_SOURCE');
  assert.equal(out.verifications[0].verified,false);
});

test('reference and visual evidence reject missing or mismatched owned sources',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-missing-'));
  const image=join(dir,'image.png');writeFileSync(image,Buffer.from([1,2,3]));
  const task={id:'T',instruction:'x',projectScopes:[],attachments:[{id:'A-1',name:'image.png',path:image}],references:[{source_task_id:'T-OLD',title:'旧任务',final_result:'旧结论'}]};
  const verifier=new SourceTraceVerifier();
  try{
    assert.equal(verifier.verifyEvidence({task:{...task,references:[]},evidence:{strength:'direct',sourceType:'reference',locator:'reference:none',observation:'旧结论'}}).traceable,false);
    assert.equal(verifier.verifyEvidence({task,evidence:{strength:'direct',sourceType:'reference',locator:'reference:T-OLD',observation:'不存在的结论'}}).traceable,false);
    assert.equal(verifier.verifyEvidence({task:{...task,attachments:[]},evidence:{strength:'direct',sourceType:'attachment_visual',locator:'missing.png',observation:'x'}}).traceable,false);
    assert.equal(verifier.verifyEvidence({task,evidence:{strength:'direct',sourceType:'attachment_visual',locator:'image.png',observation:'像素语义'}}).traceable,true);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
