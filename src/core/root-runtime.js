import { WorkUnitStatus } from './types.js';
import { MAX_TOTAL_ATTEMPTS, capacityRetryDelayMs, capacityWaitingInstruction, classifyRetry, isCapacityUnavailable, isInterrupted, retryDelayMs, suspendedInstruction, waitingRetryInstruction } from './retry-policy.js';
import { normalizeAnalysisFields } from '../governance/analysis-contract.js';
import { canonicalAnalysisSummary, hasGovernedCandidateDelta, renderAnalysisResult } from '../governance/analysis-presentation.js';
import { applyCertifiedDelta, decisionFromCertifiedState, normalizeCertifiedState } from '../governance/certified-state.js';
import { taskInputRefs } from './task-input-scope.js';
import { applyAuthorityFidelity, authoritySemanticCandidatesForWork } from '../governance/task-contract-fidelity.js';
import { recordTaskDiagnostic } from './runtime-diagnostic.js';
import { capabilitiesSatisfy, requiredWorkCapabilities, workMayMutate } from './work-capability.js';
import { competingEffectAttempts } from './effect-recovery.js';

function nowIso(){return new Date().toISOString();}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function text(value){return String(value==null?'':value).trim();}
function list(value){return Array.isArray(value)?value:[];}

function snapshotWorkUnit(unit,stageId=null){
  return{
    id:unit.id,stageId,title:unit.title,
    projectAccess:unit.projectAccess||'none',networkAccess:unit.networkAccess===true,
    status:unit.status,detail:unit.detail,
    issuedAt:unit.issuedAt||null,startedAt:unit.startedAt||null,updatedAt:unit.updatedAt,completedAt:unit.completedAt||null,
    failureCount:unit.failureCount||0,nextRetryAt:unit.nextRetryAt||null,effectRecoveryRequired:unit.effectRecoveryRequired===true,
    canRetry:unit.status===WorkUnitStatus.SUSPENDED&&unit.effectRecoveryRequired!==true,
    owner:unit.owner??([WorkUnitStatus.RUNNING,WorkUnitStatus.COMPLETED,WorkUnitStatus.RETRY_WAIT,WorkUnitStatus.SUSPENDED].includes(unit.status)?'subagent':null),
  };
}

function rootActivity(kind='initial'){
  if(kind==='synthesis')return{title:'Root 综合结果',waiting:'当前 Work Unit 批次已结束；正在获取 Root 综合资源。',running:'Root 正在判断本批结果并形成下一动作。'};
  if(kind==='initial')return{title:'Root 初始判断',waiting:'正在获取 Root 执行资源。',running:'Root 正在判断当前目标并形成最小推进动作。'};
  return{title:'Root 继续判断',waiting:'新的 Task 触发已就绪；正在获取 Root 资源。',running:'Root 正在基于当前真实状态继续推进。'};
}

function workSemanticSignature(item){
  const normalize=value=>text(value).replace(/\s+/g,' ');
  return JSON.stringify({
    title:normalize(item?.title),goal:normalize(item?.goal),expectedOutput:normalize(item?.expectedOutput),stopCondition:normalize(item?.stopCondition),
    projectAccess:normalize(item?.projectAccess||'none'),networkAccess:item?.networkAccess===true,skillId:normalize(item?.skillId),
    dependsOn:list(item?.dependsOn).map(normalize).filter(Boolean).sort(),inputRefs:list(item?.inputRefs).map(normalize).filter(Boolean).sort(),
  });
}

function normalizeDecision(decision){
  return{
    kind:decision?.kind||null,
    summary:text(decision?.summary),
    finalResult:decision?.finalResult==null?null:text(decision.finalResult),
    ...normalizeAnalysisFields(decision),
    delegations:list(decision?.delegations),
    gateway:decision?.gateway||null,
    gapResolutions:list(decision?.gapResolutions),
    effectClosures:list(decision?.effectClosures),
  };
}
function composeExecutionResult(decision){return text(decision?.finalResult)||text(decision?.summary)||'任务已完成。';}
function rootInputEvidence(rootInputs=[]){
  const out=[],seen=new Set();
  for(const item of list(rootInputs))for(const evidence of list(item?.evidence)){
    const id=text(evidence?.id);if(!id||seen.has(id))continue;seen.add(id);out.push(evidence);
  }
  return out;
}
function humanHistoryForTriggerRefs(history=[],triggerRefs=[]){
  const ids=new Set(list(triggerRefs).map(text).filter(ref=>ref.startsWith('human:')).map(ref=>ref.slice(6)).filter(Boolean));
  return ids.size?list(history).filter(item=>ids.has(text(item?.id))):[];
}
function consumeHumanTriggerRefs(session,triggerRefs=[]){for(const ref of list(triggerRefs)){const value=text(ref);if(value.startsWith('human:')&&value.length>6)session.consumedHumanGatewayIds.add(value.slice(6));}}
function validatorRejectionDelta(feedback=[],actions=[]){
  return{
    feedback:list(feedback).map(item=>({ruleId:text(item?.ruleId),target:text(item?.target),reason:text(item?.reason),action:text(item?.action)})),
    actions:list(actions).map(item=>({action:text(item?.action),target:text(item?.target),reason:text(item?.reason)})),
  };
}
function invalidDelegationPlan(issues=[]){const error=new Error(`ROOT_INVALID_DELEGATION_PLAN${issues.length?`: ${issues.join(' | ')}`:''}`);error.nonRetryable=true;return error;}
function invalidControlDecision(issues=[]){const error=new Error(`ROOT_INVALID_CONTROL_DECISION${issues.length?`: ${issues.map(item=>item.reason||item).join(' | ')}`:''}`);error.nonRetryable=true;error.governanceViolations=issues;return error;}
function invalidEffectClosure(issues=[]){const error=new Error(`ROOT_INVALID_EFFECT_CLOSURE${issues.length?`: ${issues.join(' | ')}`:''}`);error.nonRetryable=true;return error;}
function obligationId(item){return text(item?.id);}
function claimObligationRefs(claim){return new Set(list(claim?.obligationRefs).map(text).filter(Boolean));}

function rootCertifiedProjection(task,session){
  const current=session?.certifiedContext||{},claims=clone(list(current.claims)),gaps=clone(list(current.gaps)),satisfied=new Set();
  for(const claim of claims){if(claim?.level!=='confirmed')continue;for(const ref of claimObligationRefs(claim))satisfied.add(ref);}
  const unresolvedObligations=list(task?.taskContract?.obligations)
    .filter(item=>obligationId(item)&&item?.certification==='supported'&&!satisfied.has(obligationId(item)))
    .map(item=>({id:obligationId(item),criterion:clone(item?.criterion||null),requirementRefs:clone(item?.requirementRefs??item?.requirement_refs??[])}));
  return{version:Number(session?.analysisState?.version)||0,claims,gaps,unresolvedObligations};
}
function rootTaskProjection(task){return{...task,workReceipts:[],analysisState:null};}

export function validateDelegationPlan(delegations,{knownWorkIds=[],availableInputRefs=null}={}){
  const raw=list(delegations),issues=[];
  const selected=raw.map((item,index)=>({
    ...item,id:text(item?.id),title:text(item?.title),goal:text(item?.goal),expectedOutput:text(item?.expectedOutput),stopCondition:text(item?.stopCondition),
    projectAccess:text(item?.projectAccess||'none').toLowerCase(),networkAccess:item?.networkAccess===true,skillId:item?.skillId==null||!text(item.skillId)?null:text(item.skillId),
    dependsOn:[...new Set(list(item?.dependsOn).map(text).filter(Boolean))],inputRefs:[...new Set(list(item?.inputRefs).map(text).filter(Boolean))],__index:index,
  }));
  const previousIds=new Set(list(knownWorkIds).map(text).filter(Boolean)),availableInputs=Array.isArray(availableInputRefs)?new Set(availableInputRefs.map(text).filter(Boolean)):null,batchIds=new Set();
  for(const item of selected){
    if(!item.id)issues.push(`第 ${item.__index+1} 项工作缺少 id。`);else if(batchIds.has(item.id)||previousIds.has(item.id))issues.push(`工作 id 重复：${item.id}。`);else batchIds.add(item.id);
    if(!item.title)issues.push(`工作 ${item.id||item.__index+1} 缺少 title。`);
    if(!item.goal)issues.push(`工作 ${item.id||item.__index+1} 缺少有限 goal。`);
    if(!item.expectedOutput)issues.push(`工作 ${item.id||item.__index+1} 缺少 expectedOutput。`);
    if(!item.stopCondition)issues.push(`工作 ${item.id||item.__index+1} 缺少 stopCondition。`);
    if(!['none','read','write'].includes(item.projectAccess))issues.push(`工作 ${item.id||item.__index+1} 的 projectAccess 必须是 none、read 或 write。`);
    if(availableInputs)for(const ref of item.inputRefs)if(!availableInputs.has(ref))issues.push(`工作 ${item.id||item.__index+1} 引用了不存在的 Task Input：${ref}。`);
    const hasProjectInput=item.inputRefs.some(ref=>ref.startsWith('project:'));
    if(item.projectAccess!=='none'&&!hasProjectInput)issues.push(`工作 ${item.id||item.__index+1} 申请 Project 访问时必须通过 inputRefs 显式选择至少一个项目。`);
    if(item.projectAccess==='none'&&hasProjectInput)issues.push(`工作 ${item.id||item.__index+1} 选择了项目输入，但 projectAccess=none。`);
  }
  for(const item of selected){
    if(!item.id)continue;
    if(item.dependsOn.includes(item.id))issues.push(`工作 ${item.id} 不能依赖自身。`);
    for(const dep of item.dependsOn)if(!batchIds.has(dep))issues.push(`工作 ${item.id} 依赖不存在于当前批次的工作：${dep}。`);
  }
  if(!issues.length&&selected.length){
    const indegree=new Map(selected.map(item=>[item.id,0])),outgoing=new Map(selected.map(item=>[item.id,[]]));
    for(const item of selected)for(const dep of item.dependsOn){indegree.set(item.id,(indegree.get(item.id)||0)+1);outgoing.get(dep).push(item.id);}
    const queue=selected.filter(item=>indegree.get(item.id)===0).map(item=>item.id);let visited=0;
    while(queue.length){const id=queue.shift();visited+=1;for(const next of outgoing.get(id)||[]){const value=indegree.get(next)-1;indegree.set(next,value);if(value===0)queue.push(next);}}
    if(visited!==selected.length)issues.push('工作依赖形成循环，当前阶段无法安全推进。');
  }
  return{valid:issues.length===0,issues:[...new Set(issues)],delegations:selected.map(({__index,...item})=>item)};
}

export class RootRuntime{
  constructor({executor,modelRouter,subagentRuntime,governanceCompiler=null,validatorRuntime=null,taskContractFidelityVerifier=null,completionEvaluator=null,maxConcurrentSubagents=3,capabilityLimits=null,retryDelaysMs=null}){
    this.executor=executor;this.modelRouter=modelRouter;this.subagentRuntime=subagentRuntime;this.governanceCompiler=governanceCompiler;this.validatorRuntime=validatorRuntime;this.taskContractFidelityVerifier=taskContractFidelityVerifier;this.completionEvaluator=completionEvaluator;
    this.maxConcurrentSubagents=Math.max(1,Math.min(5,Number(maxConcurrentSubagents)||1));this.capabilityLimits=typeof capabilityLimits==='function'?capabilityLimits:null;this.retryDelaysMs=retryDelaysMs;this.sessions=new Map();
  }
  setConcurrency(value){this.maxConcurrentSubagents=Math.max(1,Math.min(5,Number(value)||1));return this.maxConcurrentSubagents;}
  effectiveConcurrency(){const limit=Number(this.capabilityLimits?.()?.taskMaxSubagents);return Number.isInteger(limit)&&limit>0?Math.min(this.maxConcurrentSubagents,limit):this.maxConcurrentSubagents;}
  getSession(taskId){return this.sessions.get(taskId)||null;}
  isQuiescent(taskId){const s=this.sessions.get(taskId);return !s||(s.runningControllers.size===0&&s.runningPromises.size===0&&!s.rootController);}
  snapshot(taskId){const s=this.sessions.get(taskId);return s?this.makeSnapshot(s):null;}
  makeSnapshot(session){return clone({taskId:session.taskId,actor:session.actor?{...session.actor,owner:session.actor.owner||'root'}:null,stage:session.currentStage?{id:session.currentStage.id,title:session.currentStage.title,startedAt:session.currentStage.startedAt,workUnits:session.currentStage.workUnits.map(unit=>snapshotWorkUnit(unit,session.currentStage.id))}:null,completedWorkUnits:session.completedWorkUnits.map(unit=>({...unit})),updatedAt:session.updatedAt});}
  emit(session,callbacks){session.updatedAt=nowIso();callbacks.onProgress?.(this.makeSnapshot(session));}
  requestQuiesce(taskId){const session=this.sessions.get(taskId);if(!session)return false;session.cancelRequested=true;if(session.rootController)session.rootController.abort();for(const controller of session.runningControllers.values())controller.abort();return true;}
  interruptForShutdown(taskId){const session=this.sessions.get(taskId);if(!session)return false;if(session.rootController)session.rootController.abort();for(const controller of session.runningControllers.values())controller.abort();return true;}
  retryWorkUnit(taskId,workUnitId){const session=this.sessions.get(taskId),unit=session?.currentStage?.workUnits.find(x=>x.id===workUnitId);if(!unit||unit.status!==WorkUnitStatus.SUSPENDED||unit.effectRecoveryRequired===true)return false;unit.failureCount=0;unit.nextRetryAt=Date.now();unit.status=WorkUnitStatus.WAITING_RESOURCE;unit.owner=null;unit.startedAt=null;unit.completedAt=null;unit.result=null;unit.detail='已收到重新尝试请求，将从第 1/5 次开始重新执行。';unit.updatedAt=nowIso();session.updatedAt=unit.updatedAt;return true;}
  discardSession(taskId){this.sessions.delete(taskId);this.modelRouter.release?.(taskId);}
  cleanupTaskWorkspace(taskId){return this.executor.cleanupTaskWorkspace?.(taskId)??false;}

  async certifyWorkAuthority(task,callbacks,workUnits=[]){
    const candidates=authoritySemanticCandidatesForWork(task,workUnits);if(!candidates.length)return task;
    const result=this.taskContractFidelityVerifier?await this.taskContractFidelityVerifier.review({task,candidates}):{reviews:[]};
    const nextContract=applyAuthorityFidelity(task.taskContract,candidates,list(result?.reviews));callbacks.onTaskContractAuthority?.(nextContract.authority);return{...task,taskContract:nextContract};
  }

  applyEffectClosures(task,session,decision,callbacks){
    const closures=list(decision?.effectClosures);if(!closures.length)return task;
    const attempts=new Map(competingEffectAttempts(task?.executionState).map(item=>[text(item?.id),item]).filter(([id])=>id)),claims=new Map(list(session?.certifiedContext?.claims).map(item=>[text(item?.id),item]).filter(([id])=>id)),seen=new Set(),prepared=[],issues=[];
    for(const raw of closures){
      const effectAttemptId=text(raw?.effectAttemptId),claimId=text(raw?.claimId),claim=claims.get(claimId);
      if(!effectAttemptId)issues.push('effectClosure 缺少 effectAttemptId。');
      else if(seen.has(effectAttemptId))issues.push(`effectClosure 重复指向 ${effectAttemptId}。`);
      else seen.add(effectAttemptId);
      if(effectAttemptId&&!attempts.has(effectAttemptId))issues.push(`effectClosure 指向的旧 mutator 不存在或已经闭合：${effectAttemptId}。`);
      if(!claimId)issues.push(`effectClosure ${effectAttemptId||'?'} 缺少 claimId。`);
      else if(!claim)issues.push(`effectClosure ${effectAttemptId||'?'} 引用了不存在的 Claim：${claimId}。`);
      else if(claim?.level!=='confirmed')issues.push(`effectClosure ${effectAttemptId||'?'} 必须引用 CONFIRMED Claim：${claimId}。`);
      else if(!list(claim?.evidenceIds).map(text).filter(Boolean).length)issues.push(`effectClosure ${effectAttemptId||'?'} 的 Claim 没有来源凭证：${claimId}。`);
      if(effectAttemptId&&claimId&&claim?.level==='confirmed'&&list(claim.evidenceIds).length)prepared.push({effectAttemptId,claimId,evidenceIds:[...new Set(list(claim.evidenceIds).map(text).filter(Boolean))]});
    }
    if(issues.length)throw invalidEffectClosure(issues);
    if(typeof callbacks.onEffectActuationClosure!=='function')throw invalidEffectClosure(['Runtime 没有可持久化 effect closure 的 Scheduler 边界。']);
    let nextTask=task;
    for(const closure of prepared){
      const nextState=callbacks.onEffectActuationClosure({...closure,terminal:true,canMutate:false});
      if(!nextState||typeof nextState!=='object')throw invalidEffectClosure([`effectClosure ${closure.effectAttemptId} 未返回持久化后的 Runtime state。`]);
      nextTask={...nextTask,executionState:clone(nextState)};
    }
    return nextTask;
  }

  createSession(task){
    const analysisState=normalizeCertifiedState(task.analysisState),receipts=list(task.workReceipts).filter(receipt=>receipt?.signature&&receipt?.workUnit&&receipt?.result),pending=receipts.filter(receipt=>!receipt.consumed_at).map(receipt=>({...clone(receipt.result),workUnit:clone(receipt.workUnit),persistedReceipt:true}));
    const session={
      taskId:task.id,round:0,subagentResults:pending,currentStage:null,
      completedWorkUnits:receipts.map(receipt=>({id:receipt.id,stageId:null,title:receipt.workUnit.title||receipt.id,projectAccess:receipt.workUnit.projectAccess||'none',networkAccess:receipt.workUnit.networkAccess===true,status:WorkUnitStatus.COMPLETED,detail:receipt.result?.result||'工作已完成。',issuedAt:receipt.issued_at||null,startedAt:receipt.started_at||null,updatedAt:receipt.completed_at||nowIso(),completedAt:receipt.completed_at||null,failureCount:0,nextRetryAt:null,canRetry:false,owner:'subagent'})),
      cancelRequested:false,rootController:null,runningControllers:new Map(),runningPromises:new Map(),policyContext:this.governanceCompiler?.compileForTask?.(task)||null,
      analysisState,certifiedContext:analysisState.current,
      consumedHumanGatewayIds:new Set(list(analysisState.turns).flatMap(turn=>list(turn?.triggerRefs)).map(text).filter(ref=>ref.startsWith('human:')).map(ref=>ref.slice(6)).filter(Boolean)),
      issuedWorkIds:new Set(receipts.map(receipt=>text(receipt.id)).filter(Boolean)),issuedWorkSignatures:new Set(receipts.map(receipt=>text(receipt.signature)).filter(Boolean)),rootTurnCount:0,
      actor:{title:'Root 初始判断',status:WorkUnitStatus.WAITING_RESOURCE,detail:'等待可用 Root 执行资源。',updatedAt:nowIso(),owner:'root'},updatedAt:nowIso(),
    };
    this.sessions.set(task.id,session);return session;
  }

  async runRootTurn(task,session,callbacks,{humanGatewayHistory=[],rootInputs=null,activityKind='initial',rejectionDelta=null}={}){
    if(session.cancelRequested)return{kind:'cancelled'};
    const copy=rootActivity(activityKind),issuedAt=nowIso();session.actor={title:copy.title,status:WorkUnitStatus.WAITING_RESOURCE,detail:copy.waiting,issuedAt,startedAt:null,completedAt:null,updatedAt:issuedAt,owner:'root'};this.emit(session,callbacks);
    const controller=new AbortController(),rootTask=rootTaskProjection(task),certifiedContext=rootCertifiedProjection(task,session),deliveredResults=Array.isArray(rootInputs)?rootInputs:session.subagentResults.slice();session.rootController=controller;
    try{
      await this.modelRouter.prepare?.({role:'root',task:rootTask});
      const decision=normalizeDecision(await this.executor.runRoot({
        task:rootTask,subagentResults:deliveredResults,humanGatewayHistory,rejectionDelta,
        modelPolicy:this.modelRouter.route({role:'root',task:rootTask}),policyContext:this.governanceCompiler?.compileForRole?.(task,'root')||session.policyContext,certifiedContext,signal:controller.signal,
        onExecutionStarted:()=>{const startedAt=nowIso();session.actor.status=WorkUnitStatus.RUNNING;session.actor.startedAt=session.actor.startedAt||startedAt;session.actor.detail=copy.running;session.actor.updatedAt=startedAt;callbacks.onExecutionStarted?.({role:'root'});this.emit(session,callbacks);},
        onProgress:progress=>{session.actor.detail=progress.detail||progress.summary||session.actor.detail;session.actor.updatedAt=nowIso();this.emit(session,callbacks);},
      }));
      session.rootTurnCount+=1;const completedAt=nowIso();session.actor.status=WorkUnitStatus.COMPLETED;session.actor.detail='本轮 Root 判断已形成。';session.actor.completedAt=completedAt;session.actor.updatedAt=completedAt;this.emit(session,callbacks);return decision;
    }catch(error){if(session.cancelRequested&&isInterrupted(error))return{kind:'cancelled'};throw error;}finally{session.rootController=null;}
  }

  async reviewRootDecision(task,session,decision,callbacks,{humanGatewayHistory=[],rootInputs=[],triggerRefs=[]}={}){
    if(!this.validatorRuntime){if(hasGovernedCandidateDelta(decision)){const error=new Error('VALIDATOR_RUNTIME_REQUIRED: governed Candidate Delta cannot bypass Validator ownership.');error.nonRetryable=true;throw error;}return{decision,turnNode:null,rejected:false};}
    const reviewed=this.validatorRuntime.reviewRoot({decision,task,humanGatewayHistory,currentState:session.analysisState,availableEvidence:rootInputEvidence(rootInputs)});
    if(reviewed.outcome!=='pass')return{decision:null,turnNode:null,rejected:true,rejectionDelta:validatorRejectionDelta(reviewed.feedback||[],reviewed.actions||[]),actions:list(reviewed.actions)};
    const workTriggerRefs=list(rootInputs).map(item=>text(item?.delegationId||item?.workUnit?.id)).filter(Boolean).map(id=>`work:${id}`),certifiedTriggerRefs=[...new Set([...list(triggerRefs),...workTriggerRefs].map(text).filter(Boolean))];
    if(!certifiedTriggerRefs.length){const error=new Error('ROOT_TURN_WITHOUT_TRIGGER: Current Certified State is context, not a trigger for another Root Turn.');error.nonRetryable=true;throw error;}
    const before=session.analysisState,prepared=applyCertifiedDelta(before,reviewed.decision,{triggerRefs:certifiedTriggerRefs});
    const violations=list(prepared.issues).map(issue=>({ruleId:'C-003',target:issue.target||'state',reason:issue.reason,action:issue.code})),blockingGap=list(prepared.current.gaps).find(gap=>gap?.blocking===true),gatewayGapId=text(reviewed.decision?.gateway?.gapId),gatewayGap=list(prepared.current.gaps).find(gap=>text(gap?.id)===gatewayGapId)||null,normalizeQuestion=value=>text(value).replace(/\s+/g,' ');
    if(reviewed.decision?.kind==='complete'&&blockingGap)violations.push({ruleId:'C-004',target:'blocking-gap',reason:`Root 选择 complete，但当前仍有 blocking Gap：${blockingGap.question}`,action:'REJECT_INVALID_CONTROL_DECISION'});
    if(reviewed.decision?.kind==='human_gateway'&&!blockingGap)violations.push({ruleId:'C-004',target:'human-gateway',reason:'Root 选择 Human Gateway，但当前没有 blocking Gap。',action:'REJECT_INVALID_CONTROL_DECISION'});
    if(reviewed.decision?.kind==='human_gateway'&&Boolean(!gatewayGapId||!gatewayGap||gatewayGap.blocking!==true||normalizeQuestion(reviewed.decision?.gateway?.question)!==normalizeQuestion(gatewayGap?.question)))violations.push({ruleId:'C-004',target:'human-gateway-binding',reason:'Human Gateway 必须绑定当前 blocking Gap 且 question 与认证问题一致。',action:'REJECT_INVALID_CONTROL_DECISION'});
    if(violations.length)throw invalidControlDecision(violations);

    for(const gateway of list(humanGatewayHistory)){
      const gatewayId=text(gateway?.id),targetGapId=text(gateway?.targetGapId??gateway?.target_gap_id);if(!gatewayId||!targetGapId||gateway?.status!=='RESOLVED')continue;
      const beforeOpen=Boolean(before?.current?.gaps?.some?.(gap=>text(gap?.id)===targetGapId)),afterOpen=Boolean(prepared?.current?.gaps?.some?.(gap=>text(gap?.id)===targetGapId));recordTaskDiagnostic('human-gap-proof-result',{taskId:task.id,gatewayId,targetGapId,proofAttempted:beforeOpen,resolved:beforeOpen&&!afterOpen,gapStillOpen:afterOpen});
    }

    const workReceiptIds=list(rootInputs).map(item=>text(item?.delegationId||item?.workUnit?.id)).filter(Boolean);
    if(prepared.turnNode){callbacks.onCertifiedTurn?.({analysisState:prepared.state,turnNode:prepared.turnNode,workReceiptIds});session.analysisState=prepared.state;session.certifiedContext=prepared.state.current;}
    else if(workReceiptIds.length)callbacks.onWorkReceiptsConsumed?.(workReceiptIds);
    return{decision:normalizeDecision(reviewed.decision),turnNode:prepared.turnNode,rejected:false,actions:list(reviewed.actions)};
  }

  createStage(session,delegations){
    const issuedAt=nowIso(),stage={id:`stage-${session.round+1}`,title:'当前工作',startedAt:issuedAt,workUnits:[]};
    stage.workUnits=list(delegations).map((d,index)=>{
      const id=String(d.id),dependsOn=[...new Set(list(d.dependsOn).map(String))].filter(dep=>dep!==id),waiting=dependsOn.length>0;
      return{id,title:String(d.title||`工作 ${index+1}`),goal:String(d.goal||''),expectedOutput:String(d.expectedOutput||''),stopCondition:String(d.stopCondition||''),projectAccess:['read','write'].includes(d.projectAccess)?d.projectAccess:'none',networkAccess:d.networkAccess===true,inputRefs:[...list(d.inputRefs)],skillId:d.skillId||null,dependsOn,status:waiting?WorkUnitStatus.WAITING_DEPENDENCY:WorkUnitStatus.WAITING_RESOURCE,detail:waiting?'等待前置工作完成后继续。':'工作已就绪，等待可用 Agent。',issuedAt,startedAt:null,updatedAt:issuedAt,completedAt:null,failureCount:0,nextRetryAt:Date.now(),result:null,owner:null,effectRecoveryRequired:false};
    });
    session.actor=null;session.currentStage=stage;return stage;
  }
  consumeRootInputs(session,rootInputs=[]){const ids=new Set(list(rootInputs).map(item=>text(item?.delegationId||item?.workUnit?.id)).filter(Boolean));if(ids.size)session.subagentResults=session.subagentResults.filter(item=>!ids.has(text(item?.delegationId||item?.workUnit?.id)));}
  depsCompleted(stage,unit){return unit.dependsOn.every(id=>stage.workUnits.find(work=>work.id===id)?.status===WorkUnitStatus.COMPLETED);}
  hasSuspendedDependency(stage,unit){return unit.dependsOn.some(id=>stage.workUnits.find(work=>work.id===id)?.status===WorkUnitStatus.SUSPENDED);}
  updateWaitingStates(stage){for(const unit of stage.workUnits){if(unit.status!==WorkUnitStatus.WAITING_DEPENDENCY)continue;if(this.hasSuspendedDependency(stage,unit))unit.detail='前置工作已挂起；等待该工作重新执行成功后继续。';else if(this.depsCompleted(stage,unit)){unit.status=WorkUnitStatus.WAITING_RESOURCE;unit.nextRetryAt=Date.now();unit.detail='前置工作已完成，等待可用 Agent。';unit.updatedAt=nowIso();}}}

  startSubagent(task,session,unit,callbacks){
    unit.status=WorkUnitStatus.WAITING_RESOURCE;unit.owner=null;unit.effectRecoveryRequired=false;unit.detail=unit.failureCount?`正在准备第 ${unit.failureCount+1}/${MAX_TOTAL_ATTEMPTS} 次尝试。`:'工作已就绪，正在获取可用 Subagent。';unit.updatedAt=nowIso();
    const controller=new AbortController();session.runningControllers.set(unit.id,controller);this.emit(session,callbacks);
    const dependencyResults=unit.dependsOn.map(id=>{const dep=session.currentStage?.workUnits.find(work=>work.id===id);return dep?.result?{id,title:dep.title,result:dep.result}:null;}).filter(Boolean),workUnit={id:unit.id,title:unit.title,goal:unit.goal,expectedOutput:unit.expectedOutput,stopCondition:unit.stopCondition,projectAccess:unit.projectAccess||'none',networkAccess:unit.networkAccess===true,skillId:unit.skillId,dependsOn:[...unit.dependsOn],inputRefs:[...unit.inputRefs]};
    const effectCapable=workMayMutate(workUnit),effectAttemptId=effectCapable?`effect:${task.id}:${unit.id}:${unit.failureCount+1}:${Date.now()}`:null;let executionStarted=false,effectAttemptOpen=false;
    const clearSafeAdmission=()=>{if(!effectAttemptOpen||!effectAttemptId)return true;try{callbacks.onEffectAttemptCleared?.(effectAttemptId);effectAttemptOpen=false;return true;}catch(error){unit.status=WorkUnitStatus.SUSPENDED;unit.nextRetryAt=null;unit.effectRecoveryRequired=true;unit.detail=`恢复事实无法安全更新：${error?.message||error}`;unit.updatedAt=nowIso();return false;}};
    if(effectCapable){try{callbacks.onEffectAttempt?.({id:effectAttemptId,workUnitId:unit.id,signature:workSemanticSignature(workUnit),projectAccess:workUnit.projectAccess,networkAccess:workUnit.networkAccess,inputRefs:[...workUnit.inputRefs],admittedAt:nowIso(),reason:'effect-capable-work-admitted',resolved:false});effectAttemptOpen=true;}catch(error){unit.status=WorkUnitStatus.SUSPENDED;unit.nextRetryAt=null;unit.effectRecoveryRequired=true;unit.detail=`无法在现实操作前持久化恢复边界：${error?.message||error}`;unit.updatedAt=nowIso();session.runningControllers.delete(unit.id);this.emit(session,callbacks);return Promise.resolve();}}
    const promise=this.subagentRuntime.run(task,{...workUnit,dependencyResults},{
      signal:controller.signal,policyContext:this.governanceCompiler?.compileForRole?.(task,'subagent',{skillId:unit.skillId,workUnit:unit})||session.policyContext,
      onExecutionStarted:()=>{executionStarted=true;const startedAt=nowIso();unit.status=WorkUnitStatus.RUNNING;unit.owner='subagent';unit.detail=unit.failureCount?`正在进行第 ${unit.failureCount+1}/${MAX_TOTAL_ATTEMPTS} 次尝试。`:'正在执行分配的具体工作。';unit.startedAt=startedAt;unit.completedAt=null;unit.result=null;unit.updatedAt=startedAt;callbacks.onExecutionStarted?.({role:'subagent',workUnitId:unit.id});this.emit(session,callbacks);},
      onProgress:progress=>{unit.owner='subagent';unit.detail=progress.detail||progress.summary||unit.detail;unit.updatedAt=nowIso();this.emit(session,callbacks);},
    })
      .then(result=>{unit.result=result;unit.status=WorkUnitStatus.COMPLETED;unit.owner='subagent';unit.effectRecoveryRequired=false;unit.detail=result?.result||'工作已完成。';unit.completedAt=nowIso();unit.updatedAt=unit.completedAt;const receipt={id:unit.id,signature:workSemanticSignature(workUnit),workUnit,result:clone(result),issued_at:unit.issuedAt||null,started_at:unit.startedAt||null,completed_at:unit.completedAt,...(effectAttemptId?{effectAttemptId}:{})};try{callbacks.onWorkReceipt?.(receipt);effectAttemptOpen=false;}catch(error){error.nonRetryable=true;error.workReceiptPersistence=true;throw error;}session.subagentResults.push({...result,workUnit});})
      .catch(error=>{
        if(session.cancelRequested&&isInterrupted(error)){if(effectCapable&&executionStarted){unit.status=WorkUnitStatus.SUSPENDED;unit.nextRetryAt=null;unit.effectRecoveryRequired=true;unit.detail='取消已请求；先前已开始的外部操作结果仍需核对。';unit.updatedAt=nowIso();}else clearSafeAdmission();return;}
        if(isCapacityUnavailable(error)&&!executionStarted){if(!clearSafeAdmission())return;const delay=capacityRetryDelayMs(this.retryDelaysMs);unit.owner=null;unit.status=WorkUnitStatus.WAITING_RESOURCE;unit.nextRetryAt=Date.now()+delay;unit.detail=capacityWaitingInstruction(error?.message||'');unit.updatedAt=nowIso();return;}
        if(effectCapable&&!executionStarted&&!clearSafeAdmission())return;
        unit.failureCount+=1;unit.owner='subagent';
        if(effectCapable&&executionStarted){unit.status=WorkUnitStatus.SUSPENDED;unit.nextRetryAt=null;unit.effectRecoveryRequired=true;unit.detail=`执行连接在现实操作可能发生后失去确定结果；已停止自动重放，需先核对当前现实。${error?.message?` ${error.message}`:''}`;unit.updatedAt=nowIso();return;}
        const policy=classifyRetry(error);if(!policy.retryable||unit.failureCount>=MAX_TOTAL_ATTEMPTS){unit.status=WorkUnitStatus.SUSPENDED;unit.nextRetryAt=null;unit.detail=suspendedInstruction(policy.reason,policy.message,unit.failureCount);}else{const delay=retryDelayMs(unit.failureCount,this.retryDelaysMs);unit.status=WorkUnitStatus.RETRY_WAIT;unit.nextRetryAt=Date.now()+delay;unit.startedAt=null;unit.completedAt=null;unit.result=null;unit.detail=waitingRetryInstruction(policy.reason,policy.message,unit.failureCount,delay);}unit.updatedAt=nowIso();
      })
      .finally(()=>{session.runningControllers.delete(unit.id);session.runningPromises.delete(unit.id);this.emit(session,callbacks);});
    session.runningPromises.set(unit.id,promise);return promise;
  }

  async runStage(task,session,callbacks){
    const stage=session.currentStage;
    while(true){
      if(session.cancelRequested){for(const controller of session.runningControllers.values())controller.abort();if(session.runningPromises.size)await Promise.allSettled([...session.runningPromises.values()]);return{kind:'cancelled'};}
      this.updateWaitingStates(stage);
      const runningCount=stage.workUnits.filter(unit=>unit.status===WorkUnitStatus.RUNNING).length,pendingStarts=[...session.runningPromises.keys()].filter(id=>{const unit=stage.workUnits.find(work=>work.id===id);return[WorkUnitStatus.WAITING_RESOURCE,WorkUnitStatus.RETRY_WAIT].includes(unit?.status);}).length,slots=Math.max(0,this.effectiveConcurrency()-runningCount-pendingStarts),ready=stage.workUnits.filter(unit=>[WorkUnitStatus.WAITING_RESOURCE,WorkUnitStatus.RETRY_WAIT].includes(unit.status)&&!session.runningPromises.has(unit.id)&&(unit.nextRetryAt||0)<=Date.now()),started=ready.slice(0,slots).map(unit=>this.startSubagent(task,session,unit,callbacks));
      if(started.length){await Promise.race(started.map(p=>p.catch(()=>null)));continue;}
      const runningPromises=[...session.runningPromises.values()];
      if(runningPromises.length){const nextRetryAt=stage.workUnits.filter(unit=>[WorkUnitStatus.WAITING_RESOURCE,WorkUnitStatus.RETRY_WAIT].includes(unit.status)&&!session.runningPromises.has(unit.id)&&unit.nextRetryAt).map(unit=>Number(unit.nextRetryAt)).filter(Number.isFinite).sort((a,b)=>a-b)[0],waits=runningPromises.map(p=>p.catch(()=>null));if(nextRetryAt){const delay=Math.max(0,nextRetryAt-Date.now());waits.push(new Promise(resolveWait=>{const timer=setTimeout(resolveWait,delay);timer.unref?.();}));}await Promise.race(waits);continue;}
      if(stage.workUnits.every(unit=>unit.status===WorkUnitStatus.COMPLETED)){
        callbacks.onStageCompleted?.(stage.workUnits.map(unit=>({title:unit.title,detail:unit.detail,completedAt:unit.completedAt||unit.updatedAt})));
        session.completedWorkUnits.push(...stage.workUnits.map(unit=>snapshotWorkUnit(unit,stage.id)));session.currentStage=null;session.round+=1;this.emit(session,callbacks);return{kind:'stage_complete'};
      }
      const suspended=stage.workUnits.filter(unit=>unit.status===WorkUnitStatus.SUSPENDED);if(suspended.length)return{kind:'suspended',reason:`${suspended.length} 项工作已挂起`,snapshot:this.makeSnapshot(session)};
      const future=stage.workUnits.filter(unit=>[WorkUnitStatus.WAITING_RESOURCE,WorkUnitStatus.RETRY_WAIT].includes(unit.status)&&unit.nextRetryAt).map(unit=>unit.nextRetryAt);if(future.length){const retrying=stage.workUnits.some(unit=>unit.status===WorkUnitStatus.RETRY_WAIT&&unit.nextRetryAt);return{kind:retrying?'retry_wait':'waiting_resource',retryAt:Math.min(...future),snapshot:this.makeSnapshot(session),reason:retrying?'等待自动重试':'等待执行资源恢复'};}
      return{kind:'suspended',reason:'当前工作无法继续推进',snapshot:this.makeSnapshot(session)};
    }
  }

  async execute(task,{humanGatewayHistory=[],onProgress=null,onStageCompleted=null,onCertifiedTurn=null,onTaskContractAuthority=null,onWorkReceipt=null,onWorkReceiptsConsumed=null,onEffectAttempt=null,onEffectAttemptCleared=null,onEffectActuationClosure=null,onExecutionStarted=null}={}){
    const session=this.sessions.get(task.id)||this.createSession(task);session.cancelRequested=false;const callbacks={onProgress,onStageCompleted,onCertifiedTurn,onTaskContractAuthority,onWorkReceipt,onWorkReceiptsConsumed,onEffectAttempt,onEffectAttemptCleared,onEffectActuationClosure,onExecutionStarted};
    const newlyResolvedHuman=list(humanGatewayHistory).filter(g=>g?.status==='RESOLVED'&&text(g?.id)&&!session.consumedHumanGatewayIds.has(text(g.id)));let invocationTriggerRefs=newlyResolvedHuman.map(g=>`human:${text(g.id)}`);
    if(!invocationTriggerRefs.length){const reason=text(task?.ready_reason);if(session.rootTurnCount===0&&(!reason||reason==='NEW'))invocationTriggerRefs=[`task:${task.id}`];else if(reason==='RETRY_WAIT')invocationTriggerRefs=[`technical:retry:${task.id}`];else if(reason==='WAITING_RESOURCE')invocationTriggerRefs=[`technical:resource-resume:${task.id}`];else if(reason==='SUSPENDED')invocationTriggerRefs=[`technical:manual-resume:${task.id}`];else if(session.rootTurnCount===0)invocationTriggerRefs=[`task:${task.id}`];}
    let invocationTriggerConsumed=false,rejectionDelta=null,rejectionTriggerRefs=[];
    const capacityWait=async({title,detail,reason})=>{const delay=capacityRetryDelayMs(this.retryDelaysMs);session.actor={title,status:WorkUnitStatus.WAITING_RESOURCE,detail,updatedAt:nowIso(),owner:'root'};this.emit(session,callbacks);return{kind:'waiting_resource',retryAt:Date.now()+delay,snapshot:this.makeSnapshot(session),reason};};

    while(true){
      if(session.cancelRequested)return{kind:'cancelled',quiescent:this.isQuiescent(task.id)};
      if(session.currentStage){const stageOutcome=await this.runStage(task,session,callbacks);if(stageOutcome.kind==='cancelled')return{kind:'cancelled',quiescent:this.isQuiescent(task.id)};if(stageOutcome.kind!=='stage_complete')return{...stageOutcome,quiescent:this.isQuiescent(task.id)};}

      const rootInputs=session.subagentResults.slice(),workTriggerRefs=rootInputs.map(item=>text(item?.delegationId||item?.workUnit?.id)).filter(Boolean).map(id=>`work:${id}`);let rootTriggerRefs=[...workTriggerRefs];
      if(rejectionDelta){rootTriggerRefs.push(...rejectionTriggerRefs,`validator:rejection:${task.id}:${session.rootTurnCount}`);}
      else if(!rootInputs.length){if(invocationTriggerConsumed||!invocationTriggerRefs.length){const error=new Error('ROOT_TURN_WITHOUT_TRIGGER: no Task/Human/Subagent/technical trigger exists for another Root Turn.');error.nonRetryable=true;throw error;}rootTriggerRefs=[...invocationTriggerRefs];invocationTriggerConsumed=true;}
      rootTriggerRefs=[...new Set(rootTriggerRefs.map(text).filter(Boolean))];
      const activityKind=rootInputs.length?'synthesis':session.rootTurnCount===0?'initial':'triggered';let decision;
      try{decision=await this.runRootTurn(task,session,callbacks,{humanGatewayHistory:humanHistoryForTriggerRefs(humanGatewayHistory,rootTriggerRefs),rootInputs,activityKind,rejectionDelta});}
      catch(error){if(isCapacityUnavailable(error)&&rootInputs.length)return capacityWait({title:'Root 综合结果',detail:'Work Unit 批次结果已保留；等待 Root 资源。',reason:'等待 Root 综合资源恢复'});throw error;}
      if(decision.kind==='cancelled')return{kind:'cancelled',quiescent:this.isQuiescent(task.id)};

      const reviewed=await this.reviewRootDecision(task,session,decision,callbacks,{humanGatewayHistory:humanHistoryForTriggerRefs(humanGatewayHistory,rootTriggerRefs),rootInputs,triggerRefs:rootTriggerRefs});
      if(reviewed.rejected){rejectionDelta=reviewed.rejectionDelta;rejectionTriggerRefs=[...rootTriggerRefs];continue;}
      rejectionDelta=null;rejectionTriggerRefs=[];decision=reviewed.decision;task=this.applyEffectClosures(task,session,decision,callbacks);consumeHumanTriggerRefs(session,rootTriggerRefs);this.consumeRootInputs(session,rootInputs);

      if(decision.kind==='delegate'){
        if(!decision.delegations.length)throw invalidDelegationPlan(['delegate 决策必须至少包含一个 Work Unit。']);
        const plan=validateDelegationPlan(decision.delegations,{knownWorkIds:[...session.issuedWorkIds],availableInputRefs:taskInputRefs(task)}),batchSignatures=new Set();
        for(const item of plan.delegations){
          const signature=workSemanticSignature(item);
          if(batchSignatures.has(signature)){plan.issues.push(`同一 Root 决策重复创建了语义相同的工作：${item.title||item.id}。`);plan.valid=false;}
          else if(session.issuedWorkSignatures.has(signature)){plan.issues.push(`工作 ${item.title||item.id} 与当前 Task 已创建的工作语义重复。`);plan.valid=false;}
          batchSignatures.add(signature);
          if(item.skillId&&this.governanceCompiler?.hasSkill&&!this.governanceCompiler.hasSkill(item.skillId)){plan.issues.push(`工作 ${item.id} 选择了不存在的 Skill：${item.skillId}。`);plan.valid=false;}
        }
        if(!plan.valid)throw invalidDelegationPlan(plan.issues);
        task=await this.certifyWorkAuthority(task,callbacks,plan.delegations);session.policyContext=this.governanceCompiler?.compileForTask?.(task)||session.policyContext;
        if(this.governanceCompiler?.compileForRole){
          plan.delegations=plan.delegations.map(item=>{
            const grant=this.governanceCompiler.compileForRole(task,'subagent',{skillId:item.skillId,workUnit:item})?.authorizedGrant;
            if(!grant){plan.issues.push(`工作 ${item.id} 缺少 AuthorizedGrant。`);plan.valid=false;return item;}
            if(!capabilitiesSatisfy(requiredWorkCapabilities(item),grant)){plan.issues.push(`工作 ${item.id} 的 Required Work Semantics 超过 AuthorizedGrant。`);plan.valid=false;return item;}
            return{...item,projectAccess:text(grant.projectAccess||'none'),networkAccess:grant.networkAccess===true,inputRefs:[...list(grant.inputRefs)]};
          });
        }else for(const item of plan.delegations)if(item.projectAccess!=='none'||item.networkAccess===true||item.inputRefs.length){plan.issues.push(`工作 ${item.id} 请求受治理能力但没有 GovernanceCompiler。`);plan.valid=false;}
        if(!plan.valid)throw invalidDelegationPlan(plan.issues);
        for(const item of plan.delegations){session.issuedWorkIds.add(item.id);session.issuedWorkSignatures.add(workSemanticSignature(item));}
        this.createStage(session,plan.delegations);this.emit(session,callbacks);continue;
      }

      if(decision.kind==='human_gateway'){
        if(!decision.gateway?.question?.trim()){const error=new Error('ROOT_INVALID_HUMAN_GATEWAY');error.nonRetryable=true;throw error;}
        const snapshot=this.makeSnapshot(session);this.discardSession(task.id);return{kind:'needs_human',gateway:{...decision.gateway,targetGapId:decision.gateway.gapId||null},summary:decision.summary,snapshot,quiescent:true};
      }

      if(decision.kind==='complete'){
        const finalView=decision.resultMode==='analysis'?decisionFromCertifiedState(session.analysisState,decision):null,finalResult=finalView?renderAnalysisResult(finalView):composeExecutionResult(decision),finalSummary=finalView?canonicalAnalysisSummary(finalView):decision.summary,proposal={finalResult,summary:finalSummary};
        if(!this.completionEvaluator){const error=new Error('COMPLETION_EVALUATOR_REQUIRED');error.nonRetryable=true;throw error;}
        const evaluated=this.completionEvaluator.evaluate({task,proposal,certifiedContext:session.certifiedContext});
        if(evaluated?.goalState==='satisfied'){this.discardSession(task.id);return{kind:'goal_satisfied',goalState:evaluated.goalState,proposal,assessments:list(evaluated.assessments),quiescent:true};}
        const unsatisfied=list(evaluated?.unsatisfiedObligationIds),error=new Error(`ROOT_INVALID_COMPLETION_DECISION: governed obligations remain unsatisfied${unsatisfied.length?`: ${unsatisfied.join(', ')}`:''}`);error.nonRetryable=true;throw error;
      }

      const error=new Error('ROOT_INVALID_DECISION');error.nonRetryable=true;throw error;
    }
  }
}
