import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCertifiedDelta } from '../src/governance/certified-state.js';
import { SourceTraceVerifier } from '../src/governance/source-trace-verifier.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';

function analysisStateWithBlockingGap(){
  return {
    version:1,
    current:{
      resultMode:'analysis',
      evidence:[{id:'E-OLD',strength:'direct',kind:'fact',sourceType:'human',coverage:'system',statement:'旧事实',basis:'Task instruction',locator:'Task instruction',observation:'旧事实'}],
      claims:[],
      gaps:[{id:'G-SCOPE',question:'请选择当前任务范围',reason:'不同范围会改变结果',kind:'business_decision',blocking:true,evidenceIds:[]}],
      recommendations:[],steps:[],
    },
    turns:[],
  };
}

test('Gap resolution cannot delete certified uncertainty with only INDIRECT evidence',()=>{
  const state=analysisStateWithBlockingGap();
  const decision={
    resultMode:'analysis',
    evidence:[{id:'E-INDIRECT',strength:'indirect',kind:'fact',sourceType:'human',coverage:'system',statement:'按当前信息继续',basis:'Human Gateway',locator:'Human Gateway HG-1',observation:'按当前信息继续'}],
    claims:[],gaps:[],recommendations:[],steps:[],
    gapResolutions:[{gapId:'G-SCOPE',reason:'继续推动',evidenceIds:['E-INDIRECT']}],
  };
  const applied=applyCertifiedDelta(state,decision,{triggerRefs:['human:HG-1']});
  assert.ok(applied.current.gaps.some(g=>g.id==='G-SCOPE'));
  assert.ok(applied.issues.some(issue=>issue.code==='GAP_RESOLUTION_REQUIRES_DIRECT_EVIDENCE'));
});

test('Human Evidence carries the exact resolved Gateway and target Gap provenance',()=>{
  const verifier=new SourceTraceVerifier();
  const verdict=verifier.verifyEvidence({
    task:{id:'T-1',instruction:'分析当前需求'},
    humanGatewayHistory:[{id:'HG-7',status:'RESOLVED',question:'请选择当前任务范围',answer:'按当前信息继续推断',targetGapId:'G-SCOPE'}],
    evidence:{id:'E-H',strength:'direct',kind:'requirement',sourceType:'human',coverage:'system',statement:'按当前信息继续推断',basis:'Human Gateway HG-7',locator:'Human Gateway HG-7',observation:'按当前信息继续推断'},
  });
  assert.equal(verdict.verified,true);
  assert.equal(verdict.gatewayId,'HG-7');
  assert.equal(verdict.targetGapId,'G-SCOPE');
});

test('one certified state cannot recursively manufacture unlimited Root control turns without a new trigger',async()=>{
  let rootCalls=0;
  const executor={
    async runRoot({onExecutionStarted}){
      rootCalls+=1;
      onExecutionStarted?.();
      if(rootCalls>2)throw new Error('ROOT_LOOP_WAS_NOT_GUARDED');
      return {kind:'complete',summary:'candidate',stageResult:null,finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[]};
    },
  };
  const validatorRuntime={
    reviewRoot({decision}){return{outcome:'pass',decision,feedback:[],actions:[],requiresRootDecision:true};},
    async semanticReviewRoot({reviewed}){return reviewed;},
  };
  const runtime=new RootRuntime({executor,modelRouter:new ModelRouter(),subagentRuntime:{},validatorRuntime});
  const task={id:'T-LOOP',title:'control loop',instruction:'test',projectScopes:[],attachments:[],references:[],analysisState:null};
  await assert.rejects(runtime.execute(task),/ROOT_CONTROL_NON_CONVERGENCE/);
  assert.equal(rootCalls,2,'initial Root turn + one bounded control handoff only');
});


test('blocking business decision cannot be converted into another investigation Work Unit',async()=>{
  let rootCalls=0,workerCalls=0;
  const gap={id:'G-SCOPE',question:'继续原任务范围还是切换到附件范围？',reason:'这是范围选择',kind:'business_decision',blocking:true,evidenceIds:[]};
  const executor={
    async runRoot({authorityHandoff=false,onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      if(authorityHandoff)return{kind:'human_gateway',summary:'需要用户决定范围',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:{gapId:'G-SCOPE',question:gap.question,context:'范围选择属于用户决定',options:['继续原范围','切换附件范围']},delegations:[]};
      return{kind:'delegate',summary:'继续调查新范围',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[gap],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[{id:'WU-WRONG',title:'调查附件范围',goal:'调查另一个业务范围',expectedOutput:'完整实现分析',stopCondition:'找到所有实现',projectAccess:'read',skillId:null,dependsOn:[],inputRefs:[]}]};
    },
    async runSubagent(){workerCalls+=1;throw new Error('WRONG_WORK_STARTED');},
  };
  const { SubagentRuntime }=await import('../src/core/subagent-runtime.js');
  const { ValidatorRuntime }=await import('../src/governance/validator-runtime.js');
  const { AnalysisResultValidator }=await import('../src/governance/analysis-validator.js');
  const router=new ModelRouter();
  const validatorRuntime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator()});
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const runtime=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime});
  const outcome=await runtime.execute({id:'T-SCOPE',title:'范围测试',instruction:'分析原任务',projectScopes:[],attachments:[],references:[]});
  assert.equal(outcome.kind,'needs_human');
  assert.equal(outcome.gateway.targetGapId,'G-SCOPE');
  assert.equal(workerCalls,0,'Human-owned blocking decision must not be investigated by a Subagent');
  assert.equal(rootCalls,2,'initial candidate + one bounded control handoff');
});


test('any certified blocking Gap prevents further investigation delegation, regardless of Gap kind',async()=>{
  let rootCalls=0,workerCalls=0;
  const gap={id:'G-MISSING',question:'必须由外部资料确认的关键字段是什么？',reason:'没有该字段无法完成结论',kind:'missing_fact',blocking:true,evidenceIds:[]};
  const executor={
    async runRoot({authorityHandoff=false,onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      if(authorityHandoff)return{kind:'human_gateway',summary:'需要补充关键字段',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:{gapId:'G-MISSING',question:gap.question,context:gap.reason,options:[]},delegations:[]};
      return{kind:'delegate',summary:'继续搜项目碰碰运气',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[gap],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[{id:'WU-SEARCH-AGAIN',title:'再次搜索',goal:'继续扩大搜索以猜字段',expectedOutput:'字段值',stopCondition:'找到字段或无法找到即停止',projectAccess:'read',skillId:null,dependsOn:[],inputRefs:[]}]};
    },
    async runSubagent(){workerCalls+=1;throw new Error('BLOCKING_GAP_MUST_NOT_REINVESTIGATE');},
  };
  const { SubagentRuntime }=await import('../src/core/subagent-runtime.js');
  const { ValidatorRuntime }=await import('../src/governance/validator-runtime.js');
  const { AnalysisResultValidator }=await import('../src/governance/analysis-validator.js');
  const router=new ModelRouter();
  const validatorRuntime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator()});
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const runtime=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime});
  const outcome=await runtime.execute({id:'T-BLOCKING-ANY',title:'阻塞缺口',instruction:'分析',projectScopes:[],attachments:[],references:[]});
  assert.equal(outcome.kind,'needs_human');
  assert.equal(outcome.gateway.targetGapId,'G-MISSING');
  assert.equal(workerCalls,0);
  assert.equal(rootCalls,2);
});


test('Current Certified State cannot be used as a synthetic trigger for a new durable Turn',async()=>{
  const validatorRuntime={
    reviewRoot({decision}){return{outcome:'pass',decision,feedback:[],actions:[],commits:[],sourceVerifications:[]};},
    async semanticReviewRoot({reviewed}){return reviewed;},
  };
  const runtime=new RootRuntime({executor:{},modelRouter:new ModelRouter(),subagentRuntime:{},validatorRuntime});
  const task={id:'T-NO-TRIGGER',title:'x',instruction:'x',projectScopes:[],attachments:[],references:[],analysisState:analysisStateWithBlockingGap()};
  const session=runtime.createSession(task);
  const decision={kind:'delegate',summary:'no delta',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[]};
  await assert.rejects(runtime.reviewRootDecision(task,session,decision,{}, {humanGatewayHistory:[],rootInputs:[],triggerRefs:[]}),/ROOT_TURN_WITHOUT_TRIGGER/);
});

test('"continue with current information" cannot change Task scope, close the scope Gap, or start an unrelated investigation Subagent',async()=>{
  const { SubagentRuntime }=await import('../src/core/subagent-runtime.js');
  const { ValidatorRuntime }=await import('../src/governance/validator-runtime.js');
  const { AnalysisResultValidator }=await import('../src/governance/analysis-validator.js');
  const { SemanticProofVerifier }=await import('../src/governance/semantic-proof-verifier.js');

  const gapQuestion='本任务应继续分析“备件入库”，还是按当前附件改为分析“EAM外发维修取消及财务冲销”？';
  const existing=analysisStateWithBlockingGap();
  existing.current.gaps=[{id:'G-SCOPE',question:gapQuestion,reason:'任务标题与附件主题不一致，改变范围属于业务决定',kind:'business_decision',blocking:true,evidenceIds:[]}];
  let rootCalls=0,workerCalls=0,validatorCalls=0;
  const badDecision=()=>({
    kind:'delegate',summary:'需求方已明确选择按当前附件分析EAM外发维修取消及财务冲销。',stageResult:null,finalResult:null,resultMode:'analysis',
    evidence:[{id:'E-H',strength:'direct',kind:'requirement',sourceType:'human',coverage:'system',statement:'按照当前信息继续推断',basis:'Human Gateway HG-SCOPE',locator:'Human Gateway HG-SCOPE',observation:'按照当前信息继续推断'}],
    claims:[{id:'C-SCOPE',statement:'需求方已明确选择按当前附件分析EAM外发维修取消及财务冲销。',level:'confirmed',evidenceIds:['E-H'],scope:'general',coverage:'system',hops:[]}],
    gaps:[],recommendations:[],steps:[],
    gapResolutions:[{gapId:'G-SCOPE',reason:'用户选择继续，因此切换到附件主题。',evidenceIds:['E-H']}],
    gateway:null,
    delegations:[{id:'WU-WRONG-EAM',title:'核查OA外发维修取消与财务冲销实现',goal:'调查EAM外发维修取消与财务冲销现有实现',expectedOutput:'完整实现差异',stopCondition:'找到所有相关实现后停止',projectAccess:'read',skillId:null,dependsOn:[],inputRefs:[]}],
  });
  const executor={
    async runRoot({authorityHandoff=false,onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      if(authorityHandoff)return{
        kind:'human_gateway',summary:'任务范围仍需用户明确选择',stageResult:null,finalResult:null,resultMode:'analysis',
        evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],delegations:[],
        gateway:{gapId:'G-SCOPE',question:gapQuestion,context:'“继续推断”只允许在现有信息下继续，不等于选择另一个任务范围。',options:['继续分析备件入库','改为分析EAM外发维修取消及财务冲销']},
      };
      return badDecision();
    },
    async runSubagent(){workerCalls+=1;throw new Error('UNRELATED_WORK_MUST_NOT_START');},
    async runValidator({candidates,onExecutionStarted}){
      validatorCalls+=1;onExecutionStarted?.();
      return{reviews:candidates.map(candidate=>({id:candidate.id,verdict:'overreach',reason:'回答仅授权按当前信息继续推断，没有明确选择新的任务范围。'}))};
    },
  };
  const router=new ModelRouter();
  const semanticVerifier=new SemanticProofVerifier({executor,modelRouter:router});
  const validatorRuntime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),semanticVerifier});
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const runtime=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime});
  const task={id:'T-OA-SCOPE',title:'OA备件入库需求分析',instruction:'根据附件与项目告知我具体步骤',projectScopes:[],attachments:[],references:[],analysisState:existing};
  const humanGatewayHistory=[{id:'HG-SCOPE',status:'RESOLVED',question:gapQuestion,answer:'按照当前信息继续推断',targetGapId:'G-SCOPE'}];

  let latestAnalysisState=existing;
  const outcome=await runtime.execute(task,{humanGatewayHistory,onCertifiedTurn:payload=>{latestAnalysisState=payload.analysisState;}});
  assert.equal(outcome.kind,'needs_human');
  assert.equal(outcome.gateway.targetGapId,'G-SCOPE');
  assert.equal(outcome.gateway.question,gapQuestion);
  assert.equal(workerCalls,0,'scope overreach must be stopped before the unrelated Work Unit enters Executor');
  assert.equal(rootCalls,3,'bad candidate + one semantic rework + one bounded Root control handoff');
  assert.ok(validatorCalls>=2,'Human-derived scope claim and Gap resolution must receive semantic proof');
  const certified=latestAnalysisState.current;
  assert.ok(certified.gaps.some(gap=>gap.id==='G-SCOPE'),'the original scope Gap must remain certified');
  assert.ok(!certified.claims.some(claim=>claim.id==='C-SCOPE'&&claim.level==='confirmed'),'the overreaching scope claim must not become confirmed truth');
});

test('Root sees only the Human Gateway answers that trigger this turn; older resolved answers stay behind Certified State',async()=>{
  const state={version:1,current:{resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[]},turns:[{id:'TN-OLD',triggerRefs:['human:HG-OLD'],committedAt:'2026-08-11T00:00:00.000Z'}]};
  let visible=[];
  const executor={async runRoot({humanGatewayHistory,onExecutionStarted}){visible=humanGatewayHistory;onExecutionStarted?.();return{kind:'complete',summary:'done',stageResult:null,finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[]};}};
  const runtime=new RootRuntime({executor,modelRouter:new ModelRouter(),subagentRuntime:{}});
  const task={id:'T-HUMAN-CONTEXT',title:'x',instruction:'x',projectScopes:[],attachments:[],references:[],analysisState:state};
  const history=[
    {id:'HG-OLD',status:'RESOLVED',question:'旧问题',answer:'旧回答',targetGapId:'G-OLD'},
    {id:'HG-NEW',status:'RESOLVED',question:'新问题',answer:'新回答',targetGapId:'G-NEW'},
  ];
  const outcome=await runtime.execute(task,{humanGatewayHistory:history});
  assert.equal(outcome.kind,'complete');
  assert.deepEqual(visible.map(item=>item.id),['HG-NEW']);
});

test('a Human trigger is consumed only after certification so a transport failure can retry the same answer',async()=>{
  let calls=0;
  const seen=[];
  const executor={async runRoot({humanGatewayHistory,onExecutionStarted}){
    calls+=1;seen.push(humanGatewayHistory.map(item=>item.id));onExecutionStarted?.();
    if(calls===1)throw new Error('stream disconnected before completion');
    return{kind:'complete',summary:'done',stageResult:null,finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[]};
  }};
  const runtime=new RootRuntime({executor,modelRouter:new ModelRouter(),subagentRuntime:{}});
  const task={id:'T-HUMAN-RETRY',title:'x',instruction:'x',projectScopes:[],attachments:[],references:[],analysisState:null};
  const history=[{id:'HG-RETRY',status:'RESOLVED',question:'问题',answer:'按照当前信息继续推断',targetGapId:'G-X'}];
  await assert.rejects(runtime.execute(task,{humanGatewayHistory:history}),/stream disconnected/);
  const outcome=await runtime.execute(task,{humanGatewayHistory:history});
  assert.equal(outcome.kind,'complete');
  assert.deepEqual(seen,[['HG-RETRY'],['HG-RETRY']]);
});

test('durable Human provenance survives across Turns so old Gateway Evidence cannot later close a Gap without semantic proof',async()=>{
  const { ValidatorRuntime }=await import('../src/governance/validator-runtime.js');
  const { AnalysisResultValidator }=await import('../src/governance/analysis-validator.js');
  const { SemanticProofVerifier }=await import('../src/governance/semantic-proof-verifier.js');
  const traceVerifier=new SourceTraceVerifier();
  const humanHistory=[{id:'HG-OLD-SCOPE',status:'RESOLVED',question:'请选择当前任务范围',answer:'按照当前信息继续推断',targetGapId:'G-SCOPE'}];
  const traced=traceVerifier.enforce({
    task:{id:'T-DURABLE',instruction:'分析原任务'},
    humanGatewayHistory:humanHistory,
    evidence:[{id:'E-H-OLD',strength:'direct',kind:'requirement',sourceType:'human',coverage:'system',statement:'按照当前信息继续推断',basis:'Human Gateway HG-OLD-SCOPE',locator:'Human Gateway HG-OLD-SCOPE',observation:'按照当前信息继续推断',_sourceTrace:{gatewayId:'HG-SPOOF',targetGapId:'G-OTHER',context:'spoof'}}],
  });
  const durable=traced.evidence[0];
  assert.equal(durable._sourceTrace.gatewayId,'HG-OLD-SCOPE','Executor-provided provenance must be overwritten by system verification');
  assert.equal(durable._sourceTrace.targetGapId,'G-SCOPE');
  assert.equal(durable._sourceTrace.context,undefined,'raw Gateway context must not be copied into Root-visible Certified State');

  const currentState={version:1,current:{resultMode:'analysis',evidence:[durable],claims:[],gaps:[{id:'G-SCOPE',question:'请选择当前任务范围',reason:'范围选择属于业务决定',kind:'business_decision',blocking:true,evidenceIds:[]}],recommendations:[],steps:[]},turns:[]};
  const decision={kind:'delegate',summary:'later resolution attempt',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[],gapResolutions:[{gapId:'G-SCOPE',reason:'旧回答已经选择了新范围',evidenceIds:['E-H-OLD']}]};
  let validatorCalls=0;
  const executor={async runValidator({candidates,onExecutionStarted}){validatorCalls+=1;onExecutionStarted?.();assert.equal(candidates[0].candidateType,'gap_resolution');assert.equal(candidates[0].evidence[0].gatewayId,'HG-OLD-SCOPE');assert.match(candidates[0].evidence[0].sourceContext,/按照当前信息继续推断/);return{reviews:candidates.map(c=>({id:c.id,verdict:'overreach',reason:'回答只允许继续推断，没有明确选择任务范围。'}))};}};
  const router=new ModelRouter();
  const semanticVerifier=new SemanticProofVerifier({executor,modelRouter:router});
  const validator=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),sourceTraceVerifier:traceVerifier,semanticVerifier});
  const reviewed=validator.reviewRoot({decision,policyContext:{taskMode:'analysis'},attempt:1,task:{id:'T-DURABLE',instruction:'分析原任务'},humanGatewayHistory:[],currentState});
  assert.equal(reviewed.outcome,'pass');
  const safe=await validator.semanticReviewRoot({reviewed,policyContext:{taskMode:'analysis'},attempt:2,task:{id:'T-DURABLE',instruction:'分析原任务'},humanGatewayHistory:humanHistory,currentState});
  assert.equal(validatorCalls,1,'old Human Evidence must still trigger narrow semantic proof on later reuse');
  assert.equal(safe.outcome,'pass');
  assert.equal(safe.decision.gapResolutions.length,0,'semantic overreach must remove the later Gap resolution');
});

test('an explicit Human Gateway choice is submitted for the bound Gap even when Root forgets to emit Human Evidence or gapResolutions',async()=>{
  const { ValidatorRuntime }=await import('../src/governance/validator-runtime.js');
  const { AnalysisResultValidator }=await import('../src/governance/analysis-validator.js');
  const { SemanticProofVerifier }=await import('../src/governance/semantic-proof-verifier.js');

  const gapQuestion='请确认本任务应改为分析附件中的“EAM外发维修取消及财务冲销”需求，还是补充真正包含“OA备件入库”需求的材料？';
  const selected='改为分析附件中的“EAM外发维修取消及财务冲销”需求';
  const existing=analysisStateWithBlockingGap();
  existing.current.gaps=[{id:'G-SCOPE',question:gapQuestion,reason:'任务目标与附件主题冲突，必须由用户决定范围',kind:'business_decision',blocking:true,evidenceIds:[]}];

  let rootCalls=0,validatorCalls=0,latestAnalysisState=existing;
  const executor={
    async runRoot({authorityHandoff=false,onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      if(authorityHandoff)return{kind:'complete',summary:'范围已由 Human Gateway 明确，继续按已认证状态推进。',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[]};
      // Reproduce the real v0.8.7 failure: Root sees the explicit answer but
      // forgets to restate it as Evidence / gapResolutions and simply asks again.
      return{kind:'human_gateway',summary:'仍需确认范围',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],delegations:[],gateway:{gapId:'G-SCOPE',question:gapQuestion,context:'请选择最终范围。',options:[selected,'补充真正包含“OA备件入库”需求的材料']}};
    },
    async runValidator({candidates,onExecutionStarted}){
      validatorCalls+=1;onExecutionStarted?.();
      const resolution=candidates.find(candidate=>candidate.candidateType==='gap_resolution');
      assert.ok(resolution,'Runtime must create the bound Gap proof candidate even when Root omitted it');
      assert.equal(resolution.targetId,'G-SCOPE');
      assert.equal(resolution.evidence[0].targetGapId,'G-SCOPE');
      assert.match(resolution.evidence[0].sourceContext,/EAM外发维修取消及财务冲销/);
      return{reviews:candidates.map(candidate=>({id:candidate.id,verdict:'supported',reason:'用户明确选择了问题给出的第一个范围选项。'}))};
    },
  };
  const router=new ModelRouter();
  const semanticVerifier=new SemanticProofVerifier({executor,modelRouter:router});
  const validatorRuntime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),semanticVerifier});
  const runtime=new RootRuntime({executor,modelRouter:router,subagentRuntime:{},validatorRuntime});
  const task={id:'T-HUMAN-EXPLICIT',title:'OA备件入库需求分析',instruction:'根据附件与项目告知我具体步骤',projectScopes:[],attachments:[],references:[],analysisState:existing};
  const history=[{id:'HG-EXPLICIT',status:'RESOLVED',question:gapQuestion,answer:selected,targetGapId:'G-SCOPE'}];

  const outcome=await runtime.execute(task,{humanGatewayHistory:history,onCertifiedTurn:payload=>{latestAnalysisState=payload.analysisState;}});
  assert.equal(outcome.kind,'complete','a certified explicit choice must not reopen the same Human Gateway');
  assert.ok(!latestAnalysisState.current.gaps.some(gap=>gap.id==='G-SCOPE'),'the Gateway-bound Gap must be closed after semantic certification');
  assert.ok(latestAnalysisState.current.evidence.some(item=>item.id==='E-HUMAN-HG-EXPLICIT'&&item.sourceType==='human'),'the raw Human answer must become system-owned DIRECT Evidence');
  assert.equal(rootCalls,2,'one ordinary Root decision + one bounded control handoff after the stale gateway is invalidated');
  assert.ok(validatorCalls>=1);
});

test('an ambiguous first Gateway answer may re-ask once, but a later explicit option closes the same Gap and cannot produce a third identical Gateway',async()=>{
  const { ValidatorRuntime }=await import('../src/governance/validator-runtime.js');
  const { AnalysisResultValidator }=await import('../src/governance/analysis-validator.js');
  const { SemanticProofVerifier }=await import('../src/governance/semantic-proof-verifier.js');

  const gapQuestion='请确认本任务应改为分析附件中的“EAM外发维修取消及财务冲销”需求，还是补充真正包含“OA备件入库”需求的材料？';
  const explicit='改为分析附件中的“EAM外发维修取消及财务冲销”需求';
  const base=analysisStateWithBlockingGap();
  base.current.gaps=[{id:'G-SCOPE',question:gapQuestion,reason:'范围冲突',kind:'business_decision',blocking:true,evidenceIds:[]}];

  let rootCalls=0;
  const executor={
    async runRoot({authorityHandoff=false,onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      if(authorityHandoff)return{kind:'complete',summary:'范围已确认，继续推进。',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[]};
      return{kind:'human_gateway',summary:'需要确认范围',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],delegations:[],gateway:{gapId:'G-SCOPE',question:gapQuestion,context:'请选择最终范围。',options:[explicit,'补充真正包含“OA备件入库”需求的材料']}};
    },
    async runValidator({candidates,onExecutionStarted}){
      onExecutionStarted?.();
      return{reviews:candidates.map(candidate=>{
        const gatewayId=candidate?.evidence?.[0]?.gatewayId;
        return gatewayId==='HG-2'
          ? {id:candidate.id,verdict:'supported',reason:'第二次回答明确选择了第一个选项。'}
          : {id:candidate.id,verdict:'overreach',reason:'第一次回答没有明确选择问题中的两个范围之一。'};
      })};
    },
  };
  const router=new ModelRouter();
  const semanticVerifier=new SemanticProofVerifier({executor,modelRouter:router});
  const validatorRuntime=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),semanticVerifier});
  const runtime=new RootRuntime({executor,modelRouter:router,subagentRuntime:{},validatorRuntime});
  const taskBase={id:'T-HUMAN-SEQUENCE',title:'OA备件入库需求分析',instruction:'根据附件与项目告知我具体步骤',projectScopes:[],attachments:[],references:[]};

  let stateAfterFirst=base;
  const first=await runtime.execute({...taskBase,analysisState:base},{
    humanGatewayHistory:[{id:'HG-1',status:'RESOLVED',question:gapQuestion,answer:'根据OA现状继续分析',targetGapId:'G-SCOPE'}],
    onCertifiedTurn:payload=>{stateAfterFirst=payload.analysisState;},
  });
  assert.equal(first.kind,'needs_human','an ambiguous answer may legitimately require one more precise Gateway');
  assert.ok(stateAfterFirst.current.gaps.some(g=>g.id==='G-SCOPE'));
  assert.ok(stateAfterFirst.turns.some(turn=>turn.triggerRefs.includes('human:HG-1')),'the first Human trigger is durably consumed');

  let stateAfterSecond=stateAfterFirst;
  const second=await runtime.execute({...taskBase,analysisState:stateAfterFirst},{
    humanGatewayHistory:[
      {id:'HG-1',status:'RESOLVED',question:gapQuestion,answer:'根据OA现状继续分析',targetGapId:'G-SCOPE'},
      {id:'HG-2',status:'RESOLVED',question:gapQuestion,answer:explicit,targetGapId:'G-SCOPE'},
    ],
    onCertifiedTurn:payload=>{stateAfterSecond=payload.analysisState;},
  });
  assert.equal(second.kind,'complete','the explicit second answer must converge instead of creating a third identical Gateway');
  assert.ok(!stateAfterSecond.current.gaps.some(g=>g.id==='G-SCOPE'));
  assert.ok(stateAfterSecond.turns.some(turn=>turn.triggerRefs.includes('human:HG-2')),'the explicit second Human trigger is committed as the resolving transition');
  assert.ok(stateAfterSecond.current.evidence.some(e=>e.id==='E-HUMAN-HG-2'));
});
