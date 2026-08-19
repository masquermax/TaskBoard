import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { semanticProofCandidates, SemanticProofVerifier } from '../src/governance/semantic-proof-verifier.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';
import { SourceTraceVerifier } from '../src/governance/source-trace-verifier.js';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';
import { ModelRouter } from '../src/core/model-router.js';

const policy={taskMode:'analysis',rules:{constitution:[{id:'C-003'}]}};
function decision(overrides={}){return{kind:'complete',summary:'done',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[],...overrides};}
function directEvidence(id,sourceType='project_file',overrides={}){return{id,strength:'direct',kind:'fact',sourceType,coverage:'component',statement:'raw observation',basis:'source',locator:'source#L1',observation:'raw observation',...overrides};}
function confirmedClaim(id,evidenceIds,overrides={}){return{id,statement:'interpreted claim',level:'confirmed',evidenceIds,scope:'single_system',coverage:'component',hops:[],...overrides};}

test('ordinary text/code and Task-baseline human synthesis do not trigger a second model merely because wording changes or sources are combined',()=>{
  const proposed=decision({
    evidence:[directEvidence('E-1','project_file'),directEvidence('E-2','attachment_text',{locator:'req.txt#L1'})],
    claims:[confirmedClaim('C-1',['E-1','E-2'],{statement:'combined business conclusion'})],
  });
  const verifications=[
    {id:'E-1',checked:true,verified:true,path:'/scope/A.java',context:'raw observation'},
    {id:'E-2',checked:true,verified:true,path:'/task/req.txt',context:'raw observation'},
  ];
  assert.deepEqual(semanticProofCandidates(proposed,verifications),[]);

  const human=decision({evidence:[directEvidence('E-H','human',{coverage:'system',locator:'Human Gateway answer'})],claims:[confirmedClaim('C-H',['E-H'],{coverage:'system',statement:'本次范围为基础办公'})]});
  assert.deepEqual(semanticProofCandidates(human,[{id:'E-H',checked:true,verified:true,gatewayId:null,context:'Task instruction：基础办公'}]),[]);
});


test('Gateway-derived Human evidence gets narrow semantic proof for claims and Gap resolution',()=>{
  const proposed=decision({
    evidence:[directEvidence('E-H','human',{coverage:'system',locator:'Human Gateway HG-1',observation:'按照当前信息继续推断'})],
    claims:[confirmedClaim('C-SCOPE',['E-H'],{coverage:'system',statement:'用户明确选择切换到附件中的 EAM 外发维修范围'})],
    gapResolutions:[{gapId:'G-SCOPE',reason:'用户已选择新范围',evidenceIds:['E-H']}],
  });
  const state={version:1,current:{resultMode:'analysis',evidence:[],claims:[],gaps:[{id:'G-SCOPE',question:'继续原备件入库范围，还是切换到附件中的 EAM 外发维修范围？',reason:'范围冲突',kind:'business_decision',blocking:true,evidenceIds:[]}],recommendations:[],steps:[]},turns:[]};
  const candidates=semanticProofCandidates(proposed,[{id:'E-H',checked:true,verified:true,gatewayId:'HG-1',targetGapId:'G-SCOPE',context:'问题：继续原范围还是切换？\n回答：按照当前信息继续推断'}],state);
  assert.deepEqual(candidates.map(x=>[x.candidateType,x.targetId]),[['claim','C-SCOPE'],['gap_resolution','G-SCOPE']]);
  assert.equal(candidates[1].gapQuestion,'继续原备件入库范围，还是切换到附件中的 EAM 外发维修范围？');
});

test('Gateway answer semantic overreach cannot close its certified Gap on the second pass',async()=>{
  const semanticVerifier={async review(){return{checked:true,reviews:[
    {id:'C-SCOPE',targetId:'C-SCOPE',candidateType:'claim',verdict:'overreach',reason:'“继续推断”没有选择切换任务范围。'},
    {id:'gap_resolution:G-SCOPE',targetId:'G-SCOPE',candidateType:'gap_resolution',verdict:'overreach',reason:'该回答没有回答“原范围还是新范围”。'},
  ],actions:[]};}};
  const runtime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:[{id:'E-H',checked:true,verified:true,gatewayId:'HG-1',targetGapId:'G-SCOPE',context:'问题：原范围还是新范围？\n回答：按照当前信息继续推断'}]})},semanticVerifier});
  const currentState={version:1,current:{resultMode:'analysis',evidence:[],claims:[],gaps:[{id:'G-SCOPE',question:'继续原范围还是切换到新范围？',reason:'范围冲突',kind:'business_decision',blocking:true,evidenceIds:[]}],recommendations:[],steps:[]},turns:[]};
  const proposed=decision({
    evidence:[directEvidence('E-H','human',{coverage:'system',locator:'Human Gateway HG-1',observation:'按照当前信息继续推断'})],
    claims:[confirmedClaim('C-SCOPE',['E-H'],{coverage:'system',statement:'用户明确选择切换到新范围'})],
    gapResolutions:[{gapId:'G-SCOPE',reason:'用户已选择新范围',evidenceIds:['E-H']}],
  });
  const structural=runtime.reviewRoot({decision:proposed,policyContext:policy,attempt:2,seenKnowledgeKeys:new Set(),task:{id:'T'},currentState});
  assert.equal(structural.outcome,'pass');
  const reviewed=await runtime.semanticReviewRoot({reviewed:structural,policyContext:policy,attempt:2,seenKnowledgeKeys:new Set(),task:{id:'T'},currentState});
  assert.equal(reviewed.outcome,'pass');
  assert.equal(reviewed.decision.claims[0].level,'supported');
  assert.deepEqual(reviewed.decision.gapResolutions,[],'failed Human semantic proof cannot delete the certified Gap');
});

test('semantic model review is selected only when deterministic source tracing explicitly marks raw source as needsSemantic',()=>{
  const proposed=decision({
    evidence:[directEvidence('E-V','attachment_visual',{locator:'prototype.png#page=1',observation:'视觉区域'})],
    claims:[confirmedClaim('C-V',['E-V'],{statement:'外部备注不可修改'})],
  });
  const none=semanticProofCandidates(proposed,[{id:'E-V',checked:false,verified:true,path:'/task/prototype.png'}]);
  assert.equal(none.length,0);
  const selected=semanticProofCandidates(proposed,[{id:'E-V',checked:false,verified:true,needsSemantic:true,path:'/task/prototype.png',context:'cited region'}]);
  assert.equal(selected.length,1);
  assert.equal(selected[0].id,'C-V');
  assert.equal(selected[0].evidence[0].sourcePath,undefined,'semantic model does not receive filesystem paths');
  assert.equal(selected[0].evidence[0].sourceContext,'cited region');
  assert.equal(selected[0].evidence[0].basis,undefined);
});

test('visual semantic overreach is narrowed in Validator without another Root model turn',async()=>{
  const semanticVerifier={async review(){return{checked:true,reviews:[{id:'C-1',verdict:'overreach',reason:'视觉证据没有证明完整业务关系。'}],actions:[]};}};
  const runtime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:[{id:'E-1',needsSemantic:true,verified:true,path:'/task/prototype.png'}]})},semanticVerifier});
  const visualEvidence=directEvidence('E-1','attachment_visual',{locator:'prototype.png#page=1',observation:'视觉区域'});
  const proposed=decision({
    evidence:[],
    claims:[confirmedClaim('C-1',['E-1'],{statement:'完整业务关系'})],
    steps:[{order:1,text:'完整业务关系',kind:'confirmed',sourceIds:['C-1']}],
  });
  const structural=runtime.reviewRoot({decision:proposed,availableEvidence:[visualEvidence],policyContext:policy,attempt:1,seenKnowledgeKeys:new Set(),task:{id:'T'}});
  const reviewed=await runtime.semanticReviewRoot({reviewed:structural,policyContext:policy,attempt:1,seenKnowledgeKeys:new Set(),task:{id:'T'}});
  assert.equal(reviewed.outcome,'pass');
  assert.equal(reviewed.decision.claims[0].level,'supported');
  assert.equal(reviewed.decision.steps.length,0);
  assert.ok(reviewed.decision.gaps.some(g=>/完整业务关系/.test(g.question)));
  assert.ok(reviewed.commits.some(c=>c.title==='待确认边界已收敛'&&/完整业务关系/.test(c.detail)));
  assert.ok(reviewed.actions.some(a=>a.action==='CONVERT_SEMANTIC_FAILURE_TO_GAP'));
  assert.equal(reviewed.feedback[0].action,'SEMANTIC_DOWNGRADE');
});

test('system-owned source tracing downgrades Agent-authored project-search/runtime prose when no replayable record exists',()=>{
  const verifier=new SourceTraceVerifier();
  const task={id:'T',projectScopes:[],attachments:[],references:[],instruction:'x'};
  for(const sourceType of ['project_search','runtime']){
    const out=verifier.enforce({task,evidence:[{id:`E-${sourceType}`,strength:'direct',kind:'fact',sourceType,coverage:'project',statement:'未找到实现',basis:'agent',locator:'search://query',observation:'未找到实现'}]});
    assert.equal(out.evidence[0].strength,'indirect');
    assert.ok(out.actions.some(a=>a.action==='DOWNGRADE_UNVERIFIED_SOURCE_TRACE'));
  }
});

test('semantic capability unavailable fails closed only for a source explicitly requiring semantic interpretation',async()=>{
  const verifier=new SemanticProofVerifier({executor:{},modelRouter:null});
  const visualDecision=decision({
    evidence:[directEvidence('E-V','attachment_visual')],
    claims:[confirmedClaim('C-V',['E-V'])],
  });
  const out=await verifier.review({task:{id:'T'},decision:visualDecision,sourceVerifications:[{id:'E-V',needsSemantic:true,verified:true,path:'/task/p.png'}]});
  assert.equal(out.reviews[0].verdict,'overreach');
  assert.match(out.reviews[0].reason,/未提供.*独立语义认证能力/);

  const codeDecision=decision({evidence:[directEvidence('E-C','project_file')],claims:[confirmedClaim('C-C',['E-C'])]});
  const skipped=await verifier.review({task:{id:'T'},decision:codeDecision,sourceVerifications:[{id:'E-C',verified:true,path:'/scope/A.java'}]});
  assert.equal(skipped.checked,false);
  assert.deepEqual(skipped.reviews,[]);
});

test('Codex Validator narrow proof turn is read-only, network-disabled, and receives no task-planning authority',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-validator-turn-'));const project=join(dir,'project');mkdirSync(project);
  const calls=[];
  const client={async runTurn(request){calls.push(request);return JSON.stringify({reviews:[{id:'C-1',verdict:'overreach',reason:'missing proof'}]});},async health(){return{available:true,connected:true,authenticated:true};}};
  const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client});
  try{
    const result=await executor.runValidator({task:{id:'T',title:'分析',projectScopes:[{path:project}],attachments:[]},candidates:[{id:'C-1',statement:'claim',evidence:[{id:'E-1',locator:'A#L1',observation:'raw'}]}],policyContext:{taskMode:'analysis',prompt:'CAPABILITY CONTRACT — VALIDATOR',authorizedGrant:{role:'validator',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'proof-only',environmentAccess:'none'}},modelPolicy:{model:null,reasoningEffort:null}});
    assert.equal(result.reviews[0].verdict,'overreach');
    assert.equal(calls[0].networkAccess,false);
    assert.deepEqual(calls[0].writableRoots,[]);
    assert.notEqual(calls[0].cwd,project,'Validator receives an isolated scratch cwd, not Project Scope');
    assert.doesNotMatch(calls[0].prompt,new RegExp(project.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
    assert.match(calls[0].prompt,/CAPABILITY CONTRACT — VALIDATOR/);
    assert.match(calls[0].prompt,/Semantic proof obligation/);
    assert.doesNotMatch(calls[0].prompt,/create Work Unit|delegate the task/i);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Codex Validator sees only the cited visual attachment',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-validator-source-'));const project=join(dir,'project');mkdirSync(project);
  const cited=join(dir,'cited.png'),unrelated=join(dir,'unrelated.png');writeFileSync(cited,Buffer.from([0]));writeFileSync(unrelated,Buffer.from([0]));
  const calls=[];const client={async runTurn(request){calls.push(request);return JSON.stringify({reviews:[{id:'C-1',verdict:'supported',reason:'supported'}]});},async health(){return{available:true,connected:true,authenticated:true};}};
  const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client});
  try{
    await executor.runValidator({task:{id:'T',title:'分析',projectScopes:[{path:project}],attachments:[{name:'cited.png',mimeType:'image/png',path:cited},{name:'unrelated.png',mimeType:'image/png',path:unrelated}]},candidates:[{id:'C-1',statement:'外部备注不可修改',evidence:[{id:'E-1',sourceType:'attachment_visual',locator:'cited.png#page=1',observation:'外部备注不可修改',sourceContext:'cited region'}]}],policyContext:{taskMode:'analysis',prompt:'CAPABILITY CONTRACT — VALIDATOR',authorizedGrant:{role:'validator',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'proof-only',environmentAccess:'none'}},modelPolicy:{model:null,reasoningEffort:null}});
    assert.equal(calls[0].inputItems.length,1);
    assert.equal(calls[0].inputItems[0].type,'localImage');
    assert.notEqual(calls[0].inputItems[0].path,cited,'Validator receives a TaskBoard-managed copy, not the shared attachment-store path');
    assert.match(calls[0].inputItems[0].path,/validator[\\/]inputs[\\/]/);
    assert.equal(calls[0].inputItems.some(item=>item.path===unrelated),false);
    assert.doesNotMatch(calls[0].prompt,/unrelated\.png/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Gateway provenance mismatch deterministically blocks closing a different Gap without asking the semantic model',async()=>{
  let modelCalls=0;
  const executor={async runValidator(){modelCalls+=1;throw new Error('MODEL_MUST_NOT_DECIDE_GATEWAY_OWNERSHIP');}};
  const verifier=new SemanticProofVerifier({executor,modelRouter:new ModelRouter()});
  const state={version:1,current:{resultMode:'analysis',evidence:[],claims:[],gaps:[{id:'G-B',question:'Gap B?',reason:'x',kind:'business_decision',blocking:true,evidenceIds:[]}],recommendations:[],steps:[]},turns:[]};
  const proposed=decision({
    evidence:[directEvidence('E-H','human',{coverage:'system',locator:'Human Gateway HG-A',observation:'选择 A'})],
    gapResolutions:[{gapId:'G-B',reason:'用另一个 Gateway 的回答关闭 G-B',evidenceIds:['E-H']}],
  });
  const result=await verifier.review({
    task:{id:'T'},decision:proposed,currentState:state,
    sourceVerifications:[{id:'E-H',checked:true,verified:true,gatewayId:'HG-A',targetGapId:'G-A',context:'问题 A\n回答：选择 A'}],
    humanGatewayHistory:[{id:'HG-A',status:'RESOLVED',question:'问题 A',answer:'选择 A',targetGapId:'G-A'}],
  });
  assert.equal(modelCalls,0);
  assert.equal(result.reviews[0].candidateType,'gap_resolution');
  assert.equal(result.reviews[0].verdict,'overreach');
});
