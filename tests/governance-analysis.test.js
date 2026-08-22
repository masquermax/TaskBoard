import test from 'node:test';
import assert from 'node:assert/strict';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { humanGatewayEvidenceId } from '../src/governance/human-gateway-evidence.js';
import { applyCertifiedDelta, decisionFromCertifiedState, emptyCertifiedState } from '../src/governance/certified-state.js';
import { canonicalAnalysisSummary, renderAnalysisResult } from '../src/governance/analysis-presentation.js';

function evidence(id='E-1',overrides={}){return{id,strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'事实成立',basis:'src/A.java#L1',locator:'src/A.java#L1',observation:'事实成立',...overrides};}
function claim(id='C-1',evidenceIds=['E-1'],overrides={}){return{id,statement:'事实成立',level:'confirmed',evidenceIds,scope:'single_system',coverage:'component',hops:[],obligationRefs:[],...overrides};}
function decision(overrides={}){return{kind:'complete',summary:'done',finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[],...overrides};}
function passthroughSourceVerifier(){return{enforce:({evidence:items})=>({evidence:Array.isArray(items)?items:[],actions:[],verifications:[]})};}
function demoSkillLibrary(){const skill={id:'source-investigation',purpose:['demo method'],raw:'# source-investigation\n\nMethod:\n- targeted lookup'};return{list(){return[{id:skill.id,purpose:'demo method',applicableWork:[]}]},get(id){return id===skill.id?skill:null},has(id){return id===skill.id}};}

test('GovernanceCompiler projects only executable grant plus selected method context',()=>{
  const compiler=new GovernanceCompiler({skillLibrary:demoSkillLibrary()});
  const task={id:'T',title:'需求分析',instruction:'根据项目分析',projectScopes:[{path:'/project'}],taskContract:{authority:{}}};
  const root=compiler.compileForRole(task,'root');
  const subagent=compiler.compileForRole(task,'subagent',{skillId:'source-investigation',workUnit:{projectAccess:'read',networkAccess:false,inputRefs:['project:0']}});
  assert.deepEqual(root.authorizedGrant,{role:'root',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',environmentAccess:'none'});
  assert.equal(subagent.authorizedGrant.projectAccess,'read');
  assert.equal(subagent.selectedSkill.id,'source-investigation');
  assert.match(root.prompt,/sole Task-level judgment/i);
  assert.match(subagent.prompt,/execute exactly one bounded Work Unit/i);
  assert.match(subagent.prompt,/SELECTED METHOD/);
  for(const policy of [root,subagent])for(const key of ['taskMode','contract','roleGuide','fingerprint'])assert.equal(key in policy,false,`${key} must not be a parallel Runtime control surface`);
});

test('Human Gateway transport exposes a stable source id but performs no semantic transition',()=>{
  const gateway={id:'HG-1',status:'RESOLVED',targetGapId:'G-1',question:'是否允许范围 A？',answer:'我不知道'};
  assert.equal(humanGatewayEvidenceId(gateway),'E-HUMAN-HG-1');
  assert.equal(typeof gateway.gapResolutions,'undefined');
  assert.equal(typeof gateway.evidence,'undefined');
});

test('Validator checks only the source ledger relation Root actually cites',()=>{
  const runtime=new ValidatorRuntime({sourceTraceVerifier:passthroughSourceVerifier()});
  const available=evidence('E-W',{statement:'内部备注不能为空',observation:'内部备注不能为空'});
  const reviewed=runtime.reviewRoot({decision:decision({claims:[claim('C-W',['E-W'],{statement:'内部备注不能为空'})]}),task:{id:'T'},availableEvidence:[available]});
  assert.equal(reviewed.outcome,'pass');
  assert.deepEqual(reviewed.decision.evidence.map(item=>item.id),['E-W']);
});

test('only Root-authored Human Evidence plus gapResolution can close a certified Gap',()=>{
  const initial=applyCertifiedDelta(emptyCertifiedState(),decision({gaps:[{id:'G-1',question:'范围是什么？',reason:'缺少用户范围',kind:'business_decision',blocking:true,evidenceIds:[]}]}),{triggerRefs:['task:T']}).state;
  const sourceId='E-HUMAN-HG-1';
  const untouched=applyCertifiedDelta(initial,decision(),{triggerRefs:['human:HG-1']}).state;
  assert.ok(untouched.current.gaps.some(item=>item.id==='G-1'),'transport alone does not close the Gap');
  const rootDelta=decision({
    evidence:[{id:sourceId,strength:'direct',kind:'fact',sourceType:'human',coverage:'source',statement:'范围 A',basis:'HG-1',locator:'human:HG-1',observation:'范围 A'}],
    gapResolutions:[{gapId:'G-1',reason:'Root 判断回答明确给出了范围',evidenceIds:[sourceId]}],
  });
  const closed=applyCertifiedDelta(initial,rootDelta,{triggerRefs:['human:HG-1']}).state;
  assert.equal(closed.current.gaps.some(item=>item.id==='G-1'),false);
});

test('final analysis rendering is derived from certified structured content',()=>{
  const state=applyCertifiedDelta(emptyCertifiedState(),decision({evidence:[evidence()],claims:[claim()]}),{triggerRefs:['task:T']}).state;
  const finalView=decisionFromCertifiedState(state,{recommendations:[],steps:[{order:1,text:'事实成立',kind:'confirmed',sourceIds:['C-1']}]});
  assert.match(renderAnalysisResult(finalView),/事实成立/);
  assert.doesNotMatch(renderAnalysisResult(finalView),/free Root summary/);
});

test('analysis presentation keeps confirmed, inference, reference-only and unknown visibly distinct',()=>{
  const view=decision({
    evidence:[
      evidence('E-DIRECT',{basis:'src/direct.js#L1'}),
      evidence('E-INDIRECT',{strength:'indirect',sourceType:'reference',basis:'reference:T-OLD',locator:'reference:T-OLD',observation:'历史结果'}),
    ],
    claims:[
      claim('C-CONF',['E-DIRECT'],{statement:'已确认事实'}),
      claim('C-INFER',['E-DIRECT'],{statement:'基于事实的推断',level:'supported'}),
      claim('C-REF',['E-INDIRECT'],{statement:'历史结果提示的可能性',level:'supported'}),
    ],
    gaps:[{id:'G-UNKNOWN',question:'外部系统当前状态是什么？',reason:'尚未取得 Reality',kind:'missing_fact',blocking:false,evidenceIds:[]}],
  });
  const rendered=renderAnalysisResult(view),summary=canonicalAnalysisSummary(view);
  assert.match(rendered,/【其他已确认】[\s\S]*已确认事实/);
  assert.match(rendered,/【有依据的推断】[\s\S]*基于事实的推断/);
  assert.match(rendered,/【仅供参考】[\s\S]*历史结果提示的可能性/);
  assert.match(rendered,/【仍未知】[\s\S]*外部系统当前状态是什么/);
  assert.doesNotMatch(rendered,/【待确认】/);
  assert.match(summary,/1 项已确认/);assert.match(summary,/1 项有依据推断/);assert.match(summary,/1 项仅供参考/);assert.match(summary,/1 项仍未知/);
});
