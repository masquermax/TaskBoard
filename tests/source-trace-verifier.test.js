import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { SourceTraceVerifier } from '../src/governance/source-trace-verifier.js';

function analysis(evidence,claim){return{kind:'complete',summary:'x',stageResult:null,progressCommits:[],finalResult:null,resultMode:'analysis',evidence:evidence?[evidence]:[],claims:[claim],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[]};}

test('Validator checks project-file DIRECT Evidence against the traceable original source instead of Agent paraphrase',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-trace-'));mkdirSync(join(dir,'src'));
  writeFileSync(join(dir,'src','Example.java'),'void f(){\n  ATTRIBUTE1 = person.getFdNo();\n}\n','utf8');
  const task={id:'T',title:'OA需求分析',instruction:'根据项目核对',projectScopes:[{path:dir}],attachments:[],references:[]};
  const policy=new GovernanceCompiler({rootDir:process.cwd()}).compileForTask(task);
  const validator=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator()});
  try{
    const source={id:'E-1',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'申请人工号写入 ATTRIBUTE1',basis:'Example.java',locator:'src/Example.java#f',observation:'申请人工号写入 ATTRIBUTE1'};
    const reviewed=validator.reviewRoot({task,policyContext:policy,availableEvidence:[source],decision:analysis(
      null,
      {id:'C-1',statement:'申请人工号写入 ATTRIBUTE1。',level:'confirmed',evidenceIds:['E-1'],scope:'single_system',coverage:'component',hops:[]}
    )});
    assert.equal(reviewed.outcome,'pass');
    assert.equal(reviewed.decision.evidence[0].strength,'indirect');
    assert.equal(reviewed.decision.claims[0].level,'supported');
    assert.ok(reviewed.decision.gaps.length>0);
    assert.ok(reviewed.actions.some(a=>a.action==='DOWNGRADE_UNVERIFIED_SOURCE_TRACE'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Validator keeps project-file DIRECT Evidence when its raw observation exists at the traceable address',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-trace-ok-'));mkdirSync(join(dir,'src'));
  writeFileSync(join(dir,'src','Example.java'),'ATTRIBUTE1 = person.getFdNo();\n','utf8');
  const task={id:'T',title:'OA需求分析',instruction:'根据项目核对',projectScopes:[{path:dir}],attachments:[],references:[]};
  const policy=new GovernanceCompiler({rootDir:process.cwd()}).compileForTask(task);
  const validator=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator()});
  try{
    const source={id:'E-1',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'ATTRIBUTE1 = person.getFdNo();',basis:'Example.java',locator:'src/Example.java:1',observation:'ATTRIBUTE1 = person.getFdNo();'};
    const reviewed=validator.reviewRoot({task,policyContext:policy,availableEvidence:[source],decision:analysis(
      null,
      {id:'C-1',statement:'当前组件把所选 person 的 fdNo 写入 ATTRIBUTE1。',level:'confirmed',evidenceIds:['E-1'],scope:'single_system',coverage:'component',hops:[]}
    )});
    assert.equal(reviewed.outcome,'pass');
    assert.equal(reviewed.decision.evidence[0].strength,'direct');
    assert.equal(reviewed.decision.claims[0].level,'confirmed');
    assert.equal(reviewed.actions.some(a=>a.action==='DOWNGRADE_UNVERIFIED_SOURCE_TRACE'),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('traceable line address must match the cited line range, not merely the same text elsewhere in the file',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-line-'));mkdirSync(join(dir,'src'));
  writeFileSync(join(dir,'src','Example.java'),'TARGET();\nOTHER();\nTARGET();\n','utf8');
  const task={id:'T',projectScopes:[{path:dir}],attachments:[],references:[],instruction:'x'};
  const verifier=new SourceTraceVerifier();
  try{
    const out=verifier.enforce({task,evidence:[{id:'E-L',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'TARGET();',basis:'Example.java',locator:'src/Example.java#L2',observation:'TARGET();'}]});
    assert.equal(out.evidence[0].strength,'indirect');
    assert.match(out.actions[0].reason,/指定行范围/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('DIRECT Evidence from an unreadable source type is downgraded instead of silently trusting Agent prose',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-source-binary-'));mkdirSync(join(dir,'bin'));
  writeFileSync(join(dir,'bin','payload.bin'),Buffer.from([0,1,2,3]));
  const task={id:'T',projectScopes:[{path:dir}],attachments:[],references:[],instruction:'x'};
  const verifier=new SourceTraceVerifier();
  try{
    const out=verifier.enforce({task,evidence:[{id:'E-B',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'binary means X',basis:'payload.bin',locator:'bin/payload.bin',observation:'binary means X'}]});
    assert.equal(out.evidence[0].strength,'indirect');
    assert.equal(out.verifications[0].verified,false);
    assert.ok(out.actions.some(action=>action.action==='DOWNGRADE_UNVERIFIED_SOURCE_TRACE'));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('visual evidence embedded in a document does not launch semantic Validator without an exact image input',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-doc-visual-'));const doc=join(dir,'spec.docx');writeFileSync(doc,Buffer.from('placeholder'));
  const task={id:'T',projectScopes:[],attachments:[{id:'A-1',name:'spec.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',path:doc}],references:[],instruction:'x'};
  const verifier=new SourceTraceVerifier();
  try{
    const out=verifier.enforce({task,evidence:[{id:'E-V',strength:'direct',kind:'fact',sourceType:'attachment_visual',coverage:'source',statement:'截图内容',basis:'embedded image',locator:'spec.docx#image1.png',observation:'截图内容'}]});
    assert.equal(out.evidence[0].strength,'indirect');
    assert.equal(out.verifications[0].needsSemantic,undefined);
    assert.equal(out.verifications[0].verified,false);
    assert.match(out.verifications[0].reason,/精确像素输入/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
