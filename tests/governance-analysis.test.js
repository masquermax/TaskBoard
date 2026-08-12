import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { GovernanceCompiler, inferTaskMode } from '../src/governance/governance-compiler.js';
import { AnalysisResultValidator, renderAnalysisResult } from '../src/governance/analysis-validator.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';

const strictPolicy={taskMode:'analysis'};
function evidence(id, overrides={}){
  return {id,strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'事实成立',basis:'src/A.java#L1',locator:'src/A.java#L1',observation:'事实成立',...overrides};
}
function claim(id,evidenceIds=['E-1'],overrides={}){
  return {id,statement:'事实成立',level:'confirmed',evidenceIds,scope:'single_system',coverage:'component',hops:[],...overrides};
}

function demoSkillLibrary(){
  const skill={id:'source-investigation',purpose:['demo method'],raw:'# source-investigation\n\nPurpose:\n- demo method\n\nMethod:\n- targeted lookup'};
  return {list(){return[{id:skill.id,purpose:'demo method',applicableWork:[]}]},get(id){return id===skill.id?skill:null},has(id){return id===skill.id}};
}

function baseAnalysis(overrides={}){
  return {kind:'complete',summary:'done',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[],...overrides};
}


test('Governance compiler projects only the current role Contract plus an explicitly injected selected method',()=>{
  const compiler=new GovernanceCompiler({rootDir:resolve('.'),skillLibrary:demoSkillLibrary()});
  const task={title:'需求分析',instruction:'根据附件和项目分析'};
  const root=compiler.compileForRole(task,'root');
  const subagent=compiler.compileForRole(task,'subagent',{skillId:'source-investigation'});
  const validator=compiler.compileForRole(task,'validator');

  assert.equal(root.taskMode,'analysis');
  assert.equal(root.contract.id,'ROOT');
  assert.equal(subagent.contract.id,'SUBAGENT');
  assert.equal(validator.contract.id,'VALIDATOR');
  assert.equal(subagent.selectedSkill.id,'source-investigation');
  assert.equal(root.selectedSkill,null);
  assert.ok(root.skillCatalog.some(skill=>skill.id==='source-investigation'));
  assert.deepEqual(subagent.skillCatalog,[]);
  assert.doesNotMatch(root.prompt,/P1 ACTIVE ADR|ACTIVE ANALYSIS RULE|AR-00/i);
  assert.doesNotMatch(subagent.prompt,/ADR-002|AR-00/i);
  assert.match(subagent.prompt,/CAPABILITY CONTRACT — SUBAGENT/);
  assert.match(subagent.prompt,/SELECTED METHOD/);
  assert.doesNotMatch(root.prompt,/PRODUCT CONSTITUTION|C-001|C-002|C-003|C-004|C-005/);
  assert.doesNotMatch(subagent.prompt,/PRODUCT CONSTITUTION|C-001|C-002|C-003|C-004|C-005/);
  assert.doesNotMatch(validator.prompt,/PRODUCT CONSTITUTION|C-001|C-002|C-003|C-004|C-005/);
});

test('compiled runtime authority context is deeply immutable',()=>{
  const compiler=new GovernanceCompiler({rootDir:resolve('.')});
  const policy=compiler.compileForRole({title:'需求分析',instruction:'根据附件分析'},'root');
  assert.equal(Object.isFrozen(policy),true);
  assert.equal(Object.isFrozen(policy.contract),true);
  assert.throws(()=>{policy.taskMode='execution';},TypeError);
});

test('task-mode inference gives execution precedence when user explicitly asks to modify/build',()=>{
  assert.equal(inferTaskMode({title:'需求分析后修复代码',instruction:'根据分析结果修改项目并生成版本'}),'execution');
  assert.equal(inferTaskMode({title:'OA备件入库需求分析',instruction:'根据附件与项目告知具体步骤'}),'analysis');
  assert.equal(inferTaskMode({title:'看一下这个修复方案是否合理',instruction:'只评估方案，不修改代码'}),'analysis');
});

test('C-003: CONFIRMED content without DIRECT support is narrowed and the unresolved part becomes a Gap',()=>{
  const v=new AnalysisResultValidator();
  const checked=v.validateAndRepair(baseAnalysis({
    evidence:[evidence('E-1',{strength:'indirect'})],
    claims:[claim('C-1',['E-1'],{statement:'更强的业务结论'})],
  }),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.claims[0].level,'supported');
  assert.ok(checked.decision.gaps.some(g=>/更强的业务结论/.test(g.question)));
});

test('C-003: a Claim with no Evidence becomes an explicit Gap instead of a weak fact',()=>{
  const v=new AnalysisResultValidator();
  const checked=v.validateAndRepair(baseAnalysis({claims:[claim('C-1',[],{level:'supported',statement:'尚未取证的关系'})]}),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.claims.length,0);
  assert.ok(checked.decision.gaps.some(g=>/尚未取证的关系/.test(g.question)));
});

test('C-003: cross-system confirmed Claim requires explicit evidence on every declared hop',()=>{
  const v=new AnalysisResultValidator();
  const checked=v.validateAndRepair(baseAnalysis({
    evidence:[evidence('E-1',{statement:'A→B',observation:'A→B',coverage:'cross_system'})],
    claims:[claim('C-1',['E-1'],{statement:'A→B→C 已成立',scope:'cross_system',coverage:'cross_system',hops:[{from:'A',to:'B',evidenceIds:['E-1']},{from:'B',to:'C',evidenceIds:[]}]})],
  }),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.claims.length,0);
  assert.ok(checked.decision.gaps.some(g=>/B → C/.test(g.reason)));
});

test('C-003: direct requirement evidence can certify what a cross-system requirement says without pretending runtime hops are implemented',()=>{
  const v=new AnalysisResultValidator();
  const checked=v.validateAndRepair(baseAnalysis({
    evidence:[evidence('E-R',{kind:'requirement',sourceType:'attachment_text',statement:'OA审批后推送ERP，ERP后续向MWMS传递两项备注',observation:'OA审批后推送ERP，ERP后续向MWMS传递两项备注',coverage:'cross_system'})],
    claims:[claim('C-R',['E-R'],{statement:'需求要求 OA→ERP→MWMS 传递备注',scope:'cross_system',coverage:'cross_system',hops:[]})],
  }),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.claims[0].level,'confirmed');
  assert.equal(checked.decision.gaps.length,0);
});

test('Root may cite source-traced Work Unit Evidence by id without copying the Evidence payload',()=>{
  const runtime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:[]})}});
  const available=evidence('E-W',{statement:'内部备注不能为空',observation:'内部备注不能为空'});
  const reviewed=runtime.reviewRoot({
    decision:baseAnalysis({claims:[claim('C-W',['E-W'],{statement:'内部备注不能为空'})]}),
    policyContext:strictPolicy,
    task:{id:'T'},
    availableEvidence:[available],
  });
  assert.equal(reviewed.outcome,'pass');
  assert.deepEqual(reviewed.decision.evidence.map(item=>item.id),['E-W']);
  assert.equal(reviewed.decision.claims[0].level,'confirmed');
});

test('complete may close an existing blocking Gap in the same certified candidate when the resolution has traceable Evidence',()=>{
  const v=new AnalysisResultValidator();
  const checked=v.validateAndRepair(baseAnalysis({
    evidence:[evidence('E-H',{kind:'requirement',sourceType:'human',coverage:'system',statement:'基础办公',observation:'基础办公',locator:'Human Gateway answer'})],
    claims:[claim('C-H',['E-H'],{statement:'本次范围为基础办公',coverage:'system'})],
    gaps:[{id:'G-1',question:'OA 核心范围？',reason:'范围会改变结果且当前材料没有答案',kind:'business_decision',blocking:true,evidenceIds:[]}],
    gapResolutions:[{gapId:'G-1',reason:'Human Gateway 已确认范围',evidenceIds:['E-H']}],
  }),strictPolicy);
  assert.equal(checked.valid,true);
  assert.ok(!checked.violations.some(item=>item.target==='blocking-gap'));
  assert.equal(checked.decision.summary,'分析已完成：1 项已确认。');
});

test('Recommendation validation stays generic: traceable context is required, business-specific design policy belongs to Skill/Root',()=>{
  const v=new AnalysisResultValidator();
  const checked=v.validateAndRepair(baseAnalysis({
    evidence:[evidence('E-1')],
    recommendations:[{id:'R-1',statement:'候选改进',rationale:'基于当前事实进行后续评估',evidenceIds:['E-1'],gapIds:[]}],
  }),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.recommendations.length,1);

  const unbound=v.validateAndRepair(baseAnalysis({recommendations:[{id:'R-2',statement:'无来源建议',rationale:'没有上下文',evidenceIds:[],gapIds:[]}]}),strictPolicy);
  assert.equal(unbound.valid,false,'dropping the only unbound recommendation leaves no publishable Task knowledge');
  assert.equal(unbound.decision.recommendations.length,0);
  assert.ok(unbound.violations.some(v=>v.ruleId==='C-004'));
});

test('main analysis step can combine multiple CONFIRMED Claims but cannot add uncited wording',()=>{
  const v=new AnalysisResultValidator();
  const checked=v.validateAndRepair(baseAnalysis({
    evidence:[evidence('E-1',{statement:'内部备注不能为空',observation:'内部备注不能为空'}),evidence('E-2',{statement:'外部备注不可修改',observation:'外部备注不可修改'})],
    claims:[claim('C-1',['E-1'],{statement:'内部备注不能为空'}),claim('C-2',['E-2'],{statement:'外部备注不可修改'})],
    steps:[{order:1,text:'自由扩写',kind:'confirmed',sourceIds:['C-1','C-2']}],
  }),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.steps.length,1);
  assert.equal(checked.decision.steps[0].text,'内部备注不能为空；外部备注不可修改');
});

test('C-003 coverage cannot expand a component fact into project/system truth',()=>{
  const v=new AnalysisResultValidator();
  const checked=v.validateAndRepair(baseAnalysis({
    evidence:[evidence('E-1',{coverage:'component'})],
    claims:[claim('C-1',['E-1'],{statement:'整个系统都已实现',coverage:'system'})],
  }),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.claims[0].level,'supported');
  assert.ok(checked.decision.gaps.length>=1);
});

test('strict C-003 runtime context requires explicit sourceType/coverage/locator/observation instead of fabricating them',()=>{
  const v=new AnalysisResultValidator();
  const checked=v.validateAndRepair(baseAnalysis({
    evidence:[{id:'E-1',strength:'direct',kind:'fact',statement:'事实成立',basis:'some prose'}],
    claims:[{id:'C-1',statement:'事实成立',level:'confirmed',evidenceIds:['E-1'],scope:'single_system',hops:[]}],
  }),strictPolicy);
  assert.equal(checked.valid,false,'malformed source anchors cannot be silently repaired into facts');
  assert.equal(checked.decision.evidence.length,0);
  assert.equal(checked.decision.claims.length,0);
  assert.ok(checked.originalViolations.some(v=>v.ruleId==='C-003' && /Source Anchor|sourceType|coverage/.test(v.reason)));
});

test('Validator owns certification but hands a blocking certified state back to Root for the control decision',async()=>{
  let rootCalls=0;
  const handoffs=[];
  const executor={
    async runRoot({authorityHandoff=false}){
      rootCalls+=1; handoffs.push(authorityHandoff);
      if(authorityHandoff){
        return baseAnalysis({kind:'human_gateway',summary:'需要用户拥有的信息',gaps:[{id:'G-1',question:'请确认范围',reason:'没有范围无法完成目标',kind:'business_decision',blocking:true,evidenceIds:[]}],gateway:{gapId:'G-1',question:'请确认范围',context:'范围属于用户拥有的信息',options:[]}});
      }
      return baseAnalysis({gaps:[{id:'G-1',question:'请确认范围',reason:'没有范围无法完成目标',kind:'business_decision',blocking:true,evidenceIds:[]}]});
    },
    async runSubagent(){throw new Error('unused');},
  };
  const router=new ModelRouter();const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:new ValidatorRuntime({analysisValidator:new AnalysisResultValidator()})});
  const outcome=await root.execute({id:'T-1',title:'分析需求',instruction:'根据附件分析',projectScopes:[],attachments:[],references:[]});
  assert.equal(rootCalls,3,'initial candidate + one certification rework + Root control handoff');
  assert.deepEqual(handoffs,[false,false,true]);
  assert.equal(outcome.kind,'needs_human');
  assert.equal(outcome.gateway.question,'请确认范围');
});

test('Root content that still cannot be certified after one targeted rework becomes a visible Gap, not a deleted result',async()=>{
  let rootCalls=0;
  const executor={async runRoot(){rootCalls+=1;return baseAnalysis();},async runSubagent(){throw new Error('unused');}};
  const router=new ModelRouter();const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:new ValidatorRuntime({analysisValidator:new AnalysisResultValidator()})});
  const outcome=await root.execute({id:'T-2',title:'分析需求',instruction:'分析',projectScopes:[],attachments:[],references:[]});
  assert.equal(rootCalls,2);
  assert.equal(outcome.kind,'complete');
  assert.match(outcome.finalResult,/【待确认】/);
  assert.doesNotMatch(outcome.finalResult,/Validator|Subagent/,'internal role labels must not become user-facing pending items');
});

test('Root Validator rework is one bounded Root turn and does not restart Subagents by itself',async()=>{
  let rootCalls=0,workers=0;
  const executor={async runRoot(){rootCalls+=1;return baseAnalysis();},async runSubagent(){workers+=1;throw new Error('unexpected');}};
  const router=new ModelRouter();const subagent=new SubagentRuntime({executor,modelRouter:router});
  const root=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:new ValidatorRuntime({analysisValidator:new AnalysisResultValidator()})});
  const outcome=await root.execute({id:'T-3',title:'分析需求',instruction:'分析',projectScopes:[],attachments:[],references:[]});
  assert.equal(outcome.kind,'complete');
  assert.equal(rootCalls,2);
  assert.equal(workers,0);
});

test('Validator strips Agent-authored History intent and derives one Root-level knowledge boundary from certified content',()=>{
  const runtime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:[]})}});
  const reviewed=runtime.reviewRoot({
    decision:baseAnalysis({summary:'free',progressCommits:[{title:'process',detail:'git grep'}],evidence:[evidence('E-1',{sourceType:'reference'})],claims:[claim('C-1')],steps:[{order:1,text:'事实成立',kind:'confirmed',sourceIds:['C-1']}]}),
    policyContext:strictPolicy,attempt:1,seenKnowledgeKeys:new Set(),task:{id:'T'},
  });
  assert.equal(reviewed.outcome,'pass');
  assert.equal('progressCommits' in reviewed.decision,false);
  assert.equal(reviewed.commits.length,1);
  assert.equal(reviewed.commits[0].title,'阶段事实已确认');
  assert.match(reviewed.commits[0].detail,/事实成立/);
  assert.doesNotMatch(reviewed.commits[0].detail,/git grep/);
});

test('Validator drops fields outside the Root result contract instead of carrying custom Executor authority forward',()=>{
  const runtime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:[]})}});
  const reviewed=runtime.reviewRoot({
    decision:baseAnalysis({
      summary:'free',
      authorityOverride:'root-may-write-anywhere',
      progressCommits:[{title:'legacy',detail:'legacy'}],
      evidence:[evidence('E-1',{sourceType:'reference'})],
      claims:[claim('C-1')],
      steps:[{order:1,text:'事实成立',kind:'confirmed',sourceIds:['C-1']}],
    }),
    policyContext:strictPolicy,attempt:1,seenKnowledgeKeys:new Set(),task:{id:'T'},
  });
  assert.equal(reviewed.outcome,'pass');
  assert.equal('authorityOverride' in reviewed.decision,false);
  assert.equal('progressCommits' in reviewed.decision,false);
});


test('Validator History normalizes pending wording instead of duplicating 待确认 prefixes',()=>{
  const runtime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:[]})}});
  const reviewed=runtime.reviewRoot({
    decision:baseAnalysis({gaps:[{id:'G-1',question:'待确认：目标路由',reason:'缺少绑定证据',kind:'missing_fact',blocking:false,evidenceIds:[]}]}),
    policyContext:strictPolicy,attempt:1,seenKnowledgeKeys:new Set(),task:{id:'T'},
  });
  assert.equal(reviewed.outcome,'pass');
  assert.equal(reviewed.commits.length,1);
  assert.equal(reviewed.commits[0].detail,'待确认：目标路由');
  assert.doesNotMatch(reviewed.commits[0].detail,/待确认：待确认：/);
});

test('final analysis rendering is derived only from certified structured content',()=>{
  const v=new AnalysisResultValidator();
  const checked=v.validateAndRepair(baseAnalysis({summary:'Root free summary',stageResult:'Root free stage',finalResult:'free final',evidence:[evidence('E-1')],claims:[claim('C-1')],steps:[{order:1,text:'事实成立',kind:'confirmed',sourceIds:['C-1']}]}),strictPolicy);
  assert.equal(checked.valid,true);
  assert.equal(checked.decision.finalResult,null);
  assert.equal(checked.decision.stageResult,null);
  assert.match(checked.decision.summary,/1 项已确认/);
  assert.doesNotMatch(renderAnalysisResult(checked.decision),/free final|free stage|free summary/);
});
