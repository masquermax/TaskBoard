import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { GovernanceCompiler, inferTaskMode } from '../src/governance/governance-compiler.js';
import { AnalysisResultValidator, renderAnalysisResult } from '../src/governance/analysis-validator.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';

const strictPolicy={taskMode:'analysis'};
function evidence(id,overrides={}){return{id,strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'事实成立',basis:'src/A.java#L1',locator:'src/A.java#L1',observation:'事实成立',...overrides};}
function claim(id,evidenceIds=['E-1'],overrides={}){return{id,statement:'事实成立',level:'confirmed',evidenceIds,scope:'single_system',coverage:'component',hops:[],...overrides};}
function baseAnalysis(overrides={}){return{kind:'complete',summary:'done',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[],...overrides};}
function passthroughSourceVerifier(){return{enforce:({evidence})=>({evidence:Array.isArray(evidence)?evidence:[],actions:[],verifications:[]})};}

function demoSkillLibrary(){
  const skill={id:'source-investigation',purpose:['demo method'],raw:'# source-investigation\n\nPurpose:\n- demo method\n\nMethod:\n- targeted lookup'};
  return {list(){return[{id:skill.id,purpose:'demo method',applicableWork:[]}]},get(id){return id===skill.id?skill:null},has(id){return id===skill.id}};
}

test('Governance compiler projects compact role guides and keeps taskMode non-authoritative',()=>{
  const compiler=new GovernanceCompiler({rootDir:resolve('.'),skillLibrary:demoSkillLibrary()});
  const task={title:'需求分析',instruction:'根据附件和项目分析'};
  const root=compiler.compileForRole(task,'root');
  const subagent=compiler.compileForRole(task,'subagent',{skillId:'source-investigation'});
  const validator=compiler.compileForRole(task,'validator');
  assert.equal(root.taskMode,'analysis');
  assert.equal(root.contract.id,'ROOT');
  assert.equal(subagent.contract.id,'SUBAGENT');
  assert.equal(validator.contract.id,'VALIDATOR');
  assert.match(root.prompt,/sole Task-level judgment owner/);
  assert.match(subagent.prompt,/The hands/);
  assert.match(validator.prompt,/The accountant/);
  assert.match(subagent.prompt,/SELECTED METHOD/);
  assert.doesNotMatch(root.prompt,/PRODUCT CONSTITUTION|C-001|C-002|C-003|C-004|C-005/);
});

test('task-mode inference still gives explicit execution precedence',()=>{
  assert.equal(inferTaskMode({title:'需求分析后修复代码',instruction:'根据分析结果修改项目并生成版本'}),'execution');
  assert.equal(inferTaskMode({title:'OA备件入库需求分析',instruction:'根据附件与项目告知具体步骤'}),'analysis');
  assert.equal(inferTaskMode({title:'看一下这个修复方案是否合理',instruction:'只评估方案，不修改代码'}),'analysis');
});

test('C-003 narrows CONFIRMED content without DIRECT support into inference plus Gap',()=>{
  const checked=new AnalysisResultValidator().validateAndRepair(baseAnalysis({
    evidence:[evidence('E-1',{strength:'indirect'})],
    claims:[claim('C-1',['E-1'],{statement:'更强的业务结论'})],
  }),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.claims[0].level,'supported');
  assert.ok(checked.decision.gaps.some(g=>/更强的业务结论/.test(g.question)));
});

test('C-003 turns an unsupported relation into a Gap instead of a fact',()=>{
  const checked=new AnalysisResultValidator().validateAndRepair(baseAnalysis({claims:[claim('C-1',[],{level:'supported',statement:'尚未取证的关系'})]}),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.claims.length,0);
  assert.ok(checked.decision.gaps.some(g=>/尚未取证的关系/.test(g.question)));
});

test('cross-system CONFIRMED Claim requires direct evidence on each declared hop',()=>{
  const checked=new AnalysisResultValidator().validateAndRepair(baseAnalysis({
    evidence:[evidence('E-1',{statement:'A→B',observation:'A→B',coverage:'cross_system'})],
    claims:[claim('C-1',['E-1'],{statement:'A→B→C 已成立',scope:'cross_system',coverage:'cross_system',hops:[{from:'A',to:'B',evidenceIds:['E-1']},{from:'B',to:'C',evidenceIds:[]}]})],
  }),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.claims.length,0);
  assert.ok(checked.decision.gaps.some(g=>/B → C/.test(g.reason)));
});

test('direct requirement Evidence certifies what the requirement says without pretending implementation truth',()=>{
  const checked=new AnalysisResultValidator().validateAndRepair(baseAnalysis({
    evidence:[evidence('E-R',{kind:'requirement',sourceType:'attachment_text',statement:'OA审批后推送ERP，ERP后续向MWMS传递两项备注',observation:'OA审批后推送ERP，ERP后续向MWMS传递两项备注',coverage:'cross_system'})],
    claims:[claim('C-R',['E-R'],{statement:'需求要求 OA→ERP→MWMS 传递备注',scope:'cross_system',coverage:'cross_system',hops:[]})],
  }),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.claims[0].level,'confirmed');
});

test('Root may cite source-traced Work Unit Evidence by id without copying payload',()=>{
  const runtime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),sourceTraceVerifier:passthroughSourceVerifier()});
  const available=evidence('E-W',{statement:'内部备注不能为空',observation:'内部备注不能为空'});
  const reviewed=runtime.reviewRoot({decision:baseAnalysis({claims:[claim('C-W',['E-W'],{statement:'内部备注不能为空'})]}),policyContext:strictPolicy,task:{id:'T'},availableEvidence:[available]});
  assert.equal(reviewed.outcome,'pass');
  assert.deepEqual(reviewed.decision.evidence.map(item=>item.id),['E-W']);
  assert.equal(reviewed.decision.claims[0].level,'confirmed');
});

test('blocking certified state hands control back to Root directly, without a Validator rewrite turn',async()=>{
  let rootCalls=0;const handoffs=[];
  const executor={
    async runRoot({authorityHandoff=false}){
      rootCalls+=1;handoffs.push(authorityHandoff);
      if(authorityHandoff)return baseAnalysis({kind:'human_gateway',summary:'需要用户拥有的信息',gaps:[{id:'G-1',question:'请确认范围',reason:'没有范围无法完成目标',kind:'business_decision',blocking:true,evidenceIds:[]}],gateway:{gapId:'G-1',question:'请确认范围',context:'范围属于用户拥有的信息',options:[]}});
      return baseAnalysis({gaps:[{id:'G-1',question:'请确认范围',reason:'没有范围无法完成目标',kind:'business_decision',blocking:true,evidenceIds:[]}]});
    },
    async runSubagent(){throw new Error('unused');},
  };
  const router=new ModelRouter();const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:new ValidatorRuntime({analysisValidator:new AnalysisResultValidator()})});
  const outcome=await root.execute({id:'T-1',title:'分析需求',instruction:'根据附件分析',projectScopes:[],attachments:[],references:[]});
  assert.equal(rootCalls,2,'initial judgment + one necessary Root control decision');
  assert.deepEqual(handoffs,[false,true]);
  assert.equal(outcome.kind,'needs_human');
});

test('invalid/empty Root knowledge is narrowed deterministically without asking Root to rewrite the same evidence',async()=>{
  let rootCalls=0;
  const executor={async runRoot(){rootCalls+=1;return baseAnalysis();},async runSubagent(){throw new Error('unused');}};
  const router=new ModelRouter();const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:new ValidatorRuntime({analysisValidator:new AnalysisResultValidator()})});
  const outcome=await root.execute({id:'T-2',title:'分析需求',instruction:'分析',projectScopes:[],attachments:[],references:[]});
  assert.equal(rootCalls,1);
  assert.equal(outcome.kind,'goal_satisfied');
  assert.match(outcome.proposal.finalResult,/【待确认】/);
});

test('Validator derives History only from certified content, never Agent process intent',()=>{
  const runtime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),sourceTraceVerifier:passthroughSourceVerifier()});
  const reviewed=runtime.reviewRoot({
    decision:baseAnalysis({summary:'free',progressCommits:[{title:'process',detail:'git grep'}],evidence:[evidence('E-1',{sourceType:'reference'})],claims:[claim('C-1')],steps:[{order:1,text:'事实成立',kind:'confirmed',sourceIds:['C-1']}]}),
    policyContext:strictPolicy,seenKnowledgeKeys:new Set(),task:{id:'T'},
  });
  assert.equal(reviewed.outcome,'pass');
  assert.equal('progressCommits' in reviewed.decision,false);
  assert.equal(reviewed.commits.length,1);
  assert.doesNotMatch(reviewed.commits[0].detail,/git grep/);
});

test('final analysis rendering is derived only from certified structured content',()=>{
  const checked=new AnalysisResultValidator().validateAndRepair(baseAnalysis({summary:'Root free summary',stageResult:'Root free stage',finalResult:'free final',evidence:[evidence('E-1')],claims:[claim('C-1')],steps:[{order:1,text:'事实成立',kind:'confirmed',sourceIds:['C-1']}]}),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.finalResult,null);
  assert.equal(checked.decision.stageResult,null);
  assert.doesNotMatch(renderAnalysisResult(checked.decision),/free final|free stage|free summary/);
});
