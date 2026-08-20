import test from 'node:test';
import assert from 'node:assert/strict';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { humanGatewayEvidenceId, humanGatewayTransitionCandidate } from '../src/governance/human-gateway-evidence.js';
import { applyCertifiedDelta, decisionFromCertifiedState, emptyCertifiedState } from '../src/governance/certified-state.js';
import { renderAnalysisResult } from '../src/governance/analysis-validator.js';

function evidence(id='E-1',overrides={}){return{id,strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'事实成立',basis:'src/A.java#L1',locator:'src/A.java#L1',observation:'事实成立',...overrides};}
function claim(id='C-1',evidenceIds=['E-1'],overrides={}){return{id,statement:'事实成立',level:'confirmed',evidenceIds,scope:'single_system',coverage:'component',hops:[],obligationRefs:[],...overrides};}
function decision(overrides={}){return{kind:'complete',summary:'done',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[],...overrides};}
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

test('resolved Human Gateway answer becomes source Evidence but does not auto-resolve its Gap',()=>{
  const gateway={id:'HG-1',status:'RESOLVED',targetGapId:'G-1',question:'是否允许范围 A？',answer:'我不知道'};
  const candidate=humanGatewayTransitionCandidate(decision({gapResolutions:[]}),[gateway],{current:{gaps:[{id:'G-1'}]}},{includeGapResolution:true});
  assert.deepEqual(candidate.evidence.map(item=>item.id),[humanGatewayEvidenceId(gateway)]);
  assert.deepEqual(candidate.gapResolutions,[],'transporting a Human answer cannot perform Root semantic judgment');
});

test('Validator checks only the source ledger relation Root actually cites',()=>{
  const runtime=new ValidatorRuntime({sourceTraceVerifier:passthroughSourceVerifier()});
  const available=evidence('E-W',{statement:'内部备注不能为空',observation:'内部备注不能为空'});
  const reviewed=runtime.reviewRoot({decision:decision({claims:[claim('C-W',['E-W'],{statement:'内部备注不能为空'})]}),task:{id:'T'},availableEvidence:[available]});
  assert.equal(reviewed.outcome,'pass');
  assert.deepEqual(reviewed.decision.evidence.map(item=>item.id),['E-W']);
});

test('only Root-authored gapResolution closes a certified Gap',()=>{
  const initial=applyCertifiedDelta(emptyCertifiedState(),decision({gaps:[{id:'G-1',question:'范围是什么？',reason:'缺少用户范围',kind:'business_decision',blocking:true,evidenceIds:[]}]}),{triggerRefs:['task:T']}).state;
  const gateway={id:'HG-1',status:'RESOLVED',targetGapId:'G-1',question:'范围是什么？',answer:'范围 A'};
  const sourceId=humanGatewayEvidenceId(gateway);
  const transported=humanGatewayTransitionCandidate(decision(),[gateway]);
  const stillOpen=applyCertifiedDelta(initial,transported,{triggerRefs:['human:HG-1']}).state;
  assert.ok(stillOpen.current.gaps.some(item=>item.id==='G-1'));
  const rootResolved=humanGatewayTransitionCandidate(decision({gapResolutions:[{gapId:'G-1',reason:'Root 判断回答明确给出了范围',evidenceIds:[sourceId]}]}),[gateway]);
  const closed=applyCertifiedDelta(initial,rootResolved,{triggerRefs:['human:HG-1']}).state;
  assert.equal(closed.current.gaps.some(item=>item.id==='G-1'),false);
});

test('final analysis rendering is derived from certified structured content',()=>{
  const state=applyCertifiedDelta(emptyCertifiedState(),decision({evidence:[evidence()],claims:[claim()]}),{triggerRefs:['task:T']}).state;
  const finalView=decisionFromCertifiedState(state,{recommendations:[],steps:[{order:1,text:'事实成立',kind:'confirmed',sourceIds:['C-1']}]});
  assert.match(renderAnalysisResult(finalView),/事实成立/);
  assert.doesNotMatch(renderAnalysisResult(finalView),/free Root summary/);
});
