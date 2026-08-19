import { WorkUnitStatus } from './types.js';
import { MAX_TOTAL_ATTEMPTS, capacityRetryDelayMs, capacityWaitingInstruction, classifyRetry, isCapacityUnavailable, isInterrupted, retryDelayMs, suspendedInstruction, waitingRetryInstruction } from './retry-policy.js';
import { normalizeAnalysisFields } from '../governance/analysis-contract.js';
import { canonicalAnalysisSummary, hasGovernedCandidateDelta, renderAnalysisResult } from '../governance/analysis-validator.js';
import { applyCertifiedDelta, decisionFromCertifiedState, knowledgeKeysFromState, normalizeCertifiedState } from '../governance/certified-state.js';
import { taskInputRefs } from './task-input-scope.js';
import { humanGatewayTransitionCandidate } from '../governance/human-gateway-evidence.js';
import { applyAuthorityFidelity, authoritySemanticCandidatesForWork } from '../governance/task-contract-fidelity.js';
import { recordTaskDiagnostic } from './runtime-diagnostic.js';
import { capabilitiesSatisfy, requiredWorkCapabilities, workMayMutate } from './work-capability.js';

function nowIso(){return new Date().toISOString();}
function clone(value){return JSON.parse(JSON.stringify(value));}
function text(value){return String(value==null?'':value).trim();}

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

function rootActivityCopy(kind='initial'){
  const copy={
    initial:{title:'Root 初始判断',waiting:'正在获取 Root 执行资源。',running:'Root 正在判断当前目标并形成最小推进动作。'},
    synthesis:{title:'Root 综合结果',waiting:'当前 Work Unit 批次已结束；正在获取 Root 综合资源。',running:'Root 正在基于本批结果形成结论、证据关系与下一动作。'},
    control:{title:'Root 控制决策',waiting:'已认证边界已就绪；正在获取 Root 控制资源。',running:'Root 正在基于已认证边界选择下一动作。'},
    completion_repair:{title:'Root 完成修正',waiting:'Completion Contract 存在未满足项；正在获取 Root 资源。',running:'Root 正在补齐完成判断与 obligation 关系。'},
    triggered:{title:'Root 继续判断',waiting:'新的 Task 触发已就绪；正在获取 Root 资源。',running:'Root 正在基于新触发继续推进。'},
  };
  return copy[kind]||copy.triggered;
}

function workSemanticSignature(item){
  const normalize=value=>String(value||'').trim().replace(/\s+/g,' ');
  return JSON.stringify({
    title:normalize(item?.title),goal:normalize(item?.goal),expectedOutput:normalize(item?.expectedOutput),stopCondition:normalize(item?.stopCondition),
    projectAccess:normalize(item?.projectAccess||'none'),networkAccess:item?.networkAccess===true,skillId:normalize(item?.skillId),
    dependsOn:[...(Array.isArray(item?.dependsOn)?item.dependsOn:[])].map(normalize).filter(Boolean).sort(),
    inputRefs:[...(Array.isArray(item?.inputRefs)?item.inputRefs:[])].map(normalize).filter(Boolean).sort(),
  });
}

function normalizeDecision(decision){
  const analysis=normalizeAnalysisFields(decision);
  return{
    kind:decision?.kind||null,summary:String(decision?.summary||''),stageResult:decision?.stageResult==null?null:String(decision.stageResult),finalResult:decision?.finalResult==null?null:String(decision.finalResult),
    ...analysis,
    delegations:Array.isArray(decision?.delegations)?decision.delegations:[],gateway:decision?.gateway||null,gapResolutions:Array.isArray(decision?.gapResolutions)?decision.gapResolutions:[],
  };
}
function composeExecutionResult(decision){return decision.finalResult?.trim()||decision.summary?.trim()||'任务已完成。';}

function rootInputEvidence(rootInputs=[]){
  const out=[],seen=new Set();
  for(const item of Array.isArray(rootInputs)?rootInputs:[])for(const evidence of Array.isArray(item?.evidence)?item.evidence:[]){
    const id=text(evidence?.id);if(!id||seen.has(id))continue;seen.add(id);out.push(evidence);
  }
  return out;
}
function humanHistoryForTriggerRefs(history=[],triggerRefs=[]){
  const ids=new Set((Array.isArray(triggerRefs)?triggerRefs:[]).map(text).filter(ref=>ref.startsWith('human:')).map(ref=>ref.slice(6)).filter(Boolean));
  return ids.size?(Array.isArray(history)?history:[]).filter(item=>ids.has(text(item?.id))):[];
}
function consumeHumanTriggerRefs(session,triggerRefs=[]){for(const ref of Array.isArray(triggerRefs)?triggerRefs:[]){const value=text(ref);if(value.startsWith('human:')&&value.length>6)session.consumedHumanGatewayIds.add(value.slice(6));}}
function validationError(violations=[]){
  const summary=violations.slice(0,6).map(v=>`${v.ruleId}:${v.target}:${v.reason}`).join(' | ');
  const error=new Error(`GOVERNANCE_VALIDATION_FAILED${summary?`: ${summary}`:''}`);error.nonRetryable=true;error.governanceViolations=violations;return error;
}
function invalidDelegationPlan(issues=[]){const error=new Error(`ROOT_INVALID_DELEGATION_PLAN${issues.length?`: ${issues.join(' | ')}`:''}`);error.nonRetryable=true;return error;}

export function validateDelegationPlan(delegations,{knownWorkIds=[],availableInputRefs=null}={}){
  const raw=Array.isArray(delegations)?delegations:[],issues=[];
  const selected=raw.map((item,index)=>({
    ...item,id:text(item?.id),title:text(item?.title),goal:text(item?.goal),expectedOutput:text(item?.expectedOutput),stopCondition:text(item?.stopCondition),
    projectAccess:text(item?.projectAccess||'none').toLowerCase(),networkAccess:item?.networkAccess===true,
    skillId:item?.skillId==null||!text(item.skillId)?null:text(item.skillId),
    dependsOn:Array.isArray(item?.dependsOn)?[...new Set(item.dependsOn.map(text).filter(Boolean))]:[],
    inputRefs:Array.isArray(item?.inputRefs)?[...new Set(item.inputRefs.map(text).filter(Boolean))]:[],__index:index,
  }));
  const knownIds=new Set((Array.isArray(knownWorkIds)?knownWorkIds:[]).map(text).filter(Boolean));
  const allowedInputs=Array.isArray(availableInputRefs)?new Set(availableInputRefs.map(text).filter(Boolean)):null;
  const ids=new Set();
  for(const item of selected){
    if(!item.id)issues.push(`第 ${item.__index+1} 项工作缺少 id。`);else if(ids.has(item.id)||knownIds.has(item.id))issues.push(`工作 id 重复：${item.id}。`);else ids.add(item.id);
    if(!item.title)issues.push(`工作 ${item.id||item.__index+1} 缺少 title。`);
    if(!item.goal)issues.push(`工作 ${item.id||item.__index+1} 缺少有限 goal。`);
    if(!item.expectedOutput)issues.push(`工作 ${item.id||item.__index+1} 缺少 expectedOutput。`);
    if(!item.stopCondition)issues.push(`工作 ${item.id||item.__index+1} 缺少 stopCondition。`);
    if(!['none','read','write'].includes(item.projectAccess))issues.push(`工作 ${item.id||item.__index+1} 的 projectAccess 必须是 none、read 或 write。`);
    if(allowedInputs)for(const ref of item.inputRefs)if(!allowedInputs.has(ref))issues.push(`工作 ${item.id||item.__index+1} 引用了不存在的 Task Input：${ref}。`);
    const hasProjectInput=item.inputRefs.some(ref=>ref.startsWith('project:'));
    if(item.projectAccess!=='none'&&!hasProjectInput)issues.push(`工作 ${item.id||item.__index+1} 申请 Project 访问时必须通过 inputRefs 显式选择至少一个项目。`);
    if(item.projectAccess==='none'&&hasProjectInput)issues.push(`工作 ${item.id||item.__index+1} 选择了项目输入，但 projectAccess=none。`);
  }
  for(const item of selected){
    if(!item.id)continue;
    if(item.dependsOn.includes(item.id))issues.push(`工作 ${item.id} 不能依赖自身。`);
    for(const dep of item.dependsOn)if(!ids.has(dep)&&!knownIds.has(dep))issues.push(`工作 ${item.id} 依赖不存在的工作：${dep}。`);
  }
  if(!issues.length&&selected.length){
    const indegree=new Map(selected.map(item=>[item.id,0])),outgoing=new Map(selected.map(item=>[item.id,[]]));
    for(const item of selected)for(const dep of item.dependsOn){if(!ids.has(dep))continue;indegree.set(item.id,(indegree.get(item.id)||0)+1);outgoing.get(dep).push(item.id);}
    const queue=selected.filter(item=>indegree.get(item.id)===0).map(item=>item.id);let visited=0;
    while(queue.length){const id=queue.shift();visited+=1;for(const next of outgoing.get(id)||[]){const value=indegree.get(next)-1;indegree.set(next,value);if(value===0)queue.push(next);}}
    if(visited!==selected.length)issues.push('工作依赖形成循环，当前阶段无法安全推进。');
  }
  return{valid:issues.length===0,issues:[...new Set(issues)],delegations:selected.map(({__index,...item})=>item)};
}

export class RootRuntime{
  constructor({executor,modelRouter,subagentRuntime,governanceCompiler=null,validatorRuntime=null,taskContractFidelityVerifier=null,completionAssessmentVerifier=null,completionEvaluator=null,maxConcurrentSubagents=3,capabilityLimits=null,retryDelaysMs=null}){
    this.executor=executor;this.modelRouter=modelRouter;this.subagentRuntime=subagentRuntime;this.governanceCompiler=governanceCompiler;this.validatorRuntime=validatorRuntime;
    this.taskContractFidelityVerifier=taskContractFidelityVerifier;this.completionAssessmentVerifier=completionAssessmentVerifier;this.completionEvaluator=completionEvaluator;
    this.maxConcurrentSubagents=Math.max(1,Math.min(5,Number(maxConcurrentSubagents)||1));this.capabilityLimits=typeof capabilityLimits==='function'?capabilityLimits:null;this.retryDelaysMs=retryDelaysMs;this.sessions=new Map();
  }
  setConcurrency(value){this.maxConcurrentSubagents=Math.max(1,Math.min(5,Number(value)||1));return this.maxConcurrentSubagents;}
  effectiveConcurrency(){const limit=Number(this.capabilityLimits?.()?.taskMaxSubagents);return Number.isInteger(limit)&&limit>0?Math.min(this.maxConcurrentSubagents,limit):this.maxConcurrentSubagents;}
  getSession(taskId){return this.sessions.get(taskId)||null;}
  isQuiescent(taskId){const s=this.sessions.get(taskId);return !s||(s.runningControllers.size===0&&s.runningPromises.size===0&&!s.rootController);}
  snapshot(taskId){const s=this.sessions.get(taskId);return s?this.makeSnapshot(s):null;}
  makeSnapshot(session){return clone({taskId:session.taskId,actor:session.actor?{...session.actor,owner:session.actor.owner||'root'}:null,stage:session.currentStage?{id:session.currentStage.id,title:session.currentStage.title,startedAt:session.currentStage.startedAt,workUnits:session.currentStage.workUnits.map(unit=>snapshotWorkUnit(unit,session.currentStage.id))}:null,completedWorkUnits:session.completedWorkUnits.map(unit=>({...unit})),updatedAt:session.updatedAt});}
  emit(session,callbacks){session.updatedAt=nowIso();callbacks.onProgress?.(this.makeSnapshot(session));}
  commitProgress(session,callbacks,commits=[]){
    for(const raw of Array.isArray(commits)?commits:[]){const title=text(raw?.title),detail=text(raw?.detail);if(!title||!detail)continue;const key=`${title}\n${detail}`;if(session.committedProgressKeys.has(key))continue;callbacks.onProgressCommit?.({title,detail,completedAt:nowIso()});session.committedProgressKeys.add(key);session.lastCommittedStageResult=detail;}
  }
  requestQuiesce(taskId){const session=this.sessions.get(taskId);if(!session)return false;session.cancelRequested=true;if(session.rootController)session.rootController.abort();for(const controller of session.runningControllers.values())controller.abort();return true;}
  interruptForShutdown(taskId){const session=this.sessions.get(taskId);if(!session)return false;if(session.rootController)session.rootController.abort();for(const controller of session.runningControllers.values())controller.abort();return true;}
  retryWorkUnit(taskId,workUnitId){
    const session=this.sessions.get(taskId),unit=session?.currentStage?.workUnits.find(x=>x.id===workUnitId);
    if(!unit||unit.status!==WorkUnitStatus.SUSPENDED||unit.effectRecoveryRequired===true)return false;
    unit.failureCount=0;unit.nextRetryAt=Date.now();unit.status=WorkUnitStatus.WAITING_RESOURCE;unit.detail='已收到重新尝试请求，将从第 1/5 次开始重新执行。';unit.updatedAt=nowIso();session.updatedAt=unit.updatedAt;return true;
  }
  discardSession(taskId){this.sessions.delete(taskId);this.modelRouter.release?.(taskId);}
  cleanupTaskWorkspace(taskId){return this.executor.cleanupTaskWorkspace?.(taskId)??false;}

  async certifyWorkAuthority(task,session,callbacks,workUnits=[]){
    const candidates=authoritySemanticCandidatesForWork(task,workUnits);if(!candidates.length)return task;
    session.actor={title:'Requirement Authority 认证',status:WorkUnitStatus.WAITING_RESOURCE,detail:'Root 已提出受治理 Work capability；等待 Requirement Authority 核对。',updatedAt:nowIso(),owner:'validator'};this.emit(session,callbacks);
    let reviews=[];
    if(this.taskContractFidelityVerifier){
      const result=await this.taskContractFidelityVerifier.review({task,candidates,policyContext:this.governanceCompiler?.compileForRole?.(task,'validator')||session.policyContext,onExecutionStarted:()=>{session.actor.status=WorkUnitStatus.RUNNING;callbacks.onExecutionStarted?.({role:'validator'});this.emit(session,callbacks);},onProgress:p=>{session.actor.detail=p?.detail||p?.summary||session.actor.detail;this.emit(session,callbacks);}});
      reviews=Array.isArray(result?.reviews)?result.reviews:[];
    }
    const nextContract=applyAuthorityFidelity(task.taskContract,candidates,reviews);callbacks.onTaskContractAuthority?.(nextContract.authority);
    const next={...task,taskContract:nextContract};session.policyContext=this.governanceCompiler?.compileForTask?.(next)||session.policyContext;return next;
  }

  createSession(task){
    const restoredAnalysisState=normalizeCertifiedState(task.analysisState);
    const durableWorkReceipts=(Array.isArray(task.workReceipts)?task.workReceipts:[]).filter(receipt=>receipt?.signature&&receipt?.workUnit&&receipt?.result);
    const pendingWorkResults=durableWorkReceipts.filter(receipt=>!receipt.consumed_at).map(receipt=>({...clone(receipt.result),workUnit:clone(receipt.workUnit),persistedReceipt:true}));
    const session={
      taskId:task.id,round:0,subagentResults:pendingWorkResults,currentStage:null,
      completedWorkUnits:durableWorkReceipts.map(receipt=>({id:receipt.id,stageId:null,title:receipt.workUnit.title||receipt.id,projectAccess:receipt.workUnit.projectAccess||'none',networkAccess:receipt.workUnit.networkAccess===true,status:WorkUnitStatus.COMPLETED,detail:receipt.result?.result||'工作已完成。',issuedAt:receipt.issued_at||null,startedAt:receipt.started_at||null,updatedAt:receipt.completed_at||nowIso(),completedAt:receipt.completed_at||null,failureCount:0,nextRetryAt:null,canRetry:false,owner:'subagent'})),
      cancelRequested:false,rootController:null,runningControllers:new Map(),runningPromises:new Map(),policyContext:this.governanceCompiler?.compileForTask?.(task)||null,
      completionFeedback:null,completionRepairCount:0,completionTriggerRefs:[],
      committedProgressKeys:new Set(),lastCommittedStageResult:task.last_stage_result||null,analysisState:restoredAnalysisState,certifiedContext:restoredAnalysisState.current,certifiedKnowledgeKeys:knowledgeKeysFromState(restoredAnalysisState),
      consumedHumanGatewayIds:new Set((restoredAnalysisState.turns||[]).flatMap(turn=>turn?.triggerRefs||[]).map(text).filter(ref=>ref.startsWith('human:')).map(ref=>ref.slice(6)).filter(Boolean)),
      issuedWorkSignatures:new Set(durableWorkReceipts.map(receipt=>text(receipt.signature)).filter(Boolean)),pendingValidation:null,rootTurnCount:0,controlHandoffCount:0,
      actor:{title:'Root 初始判断',status:WorkUnitStatus.WAITING_RESOURCE,detail:'等待可用 Root 执行资源。',updatedAt:nowIso(),owner:'root'},updatedAt:nowIso(),
    };
    this.sessions.set(task.id,session);return session;
  }

  async runRootTurn(task,session,callbacks,{humanGatewayHistory=[],validationFeedback=null,previousDecision=null,rootInputs=null,authorityHandoff=false,activityKind='initial'}={}){
    if(session.cancelRequested)return{kind:'cancelled'};
    const activity=rootActivityCopy(activityKind),issuedAt=nowIso();
    session.actor={title:activity.title,status:WorkUnitStatus.WAITING_RESOURCE,detail:activity.waiting,issuedAt,startedAt:null,completedAt:null,updatedAt:issuedAt,owner:'root'};this.emit(session,callbacks);
    const controller=new AbortController();
    const deliveredResults=Array.isArray(rootInputs)?rootInputs:session.subagentResults.slice();
    const activeWork=session.currentStage?session.currentStage.workUnits.map(unit=>({id:unit.id,title:unit.title,status:unit.status,projectAccess:unit.projectAccess||'none',networkAccess:unit.networkAccess===true,dependsOn:unit.dependsOn})):[];
    session.rootController=controller;
    try{
      await this.modelRouter.prepare?.({role:'root',task});
      const decision=normalizeDecision(await this.executor.runRoot({task,subagentResults:deliveredResults,activeWork,humanGatewayHistory,modelPolicy:this.modelRouter.route({role:'root',task}),policyContext:this.governanceCompiler?.compileForRole?.(task,'root')||session.policyContext,validationFeedback,previousDecision,authorityHandoff,certifiedContext:session.certifiedContext,signal:controller.signal,onExecutionStarted:()=>{const startedAt=nowIso();session.actor.status=WorkUnitStatus.RUNNING;session.actor.startedAt=session.actor.startedAt||startedAt;session.actor.detail=activity.running;session.actor.updatedAt=startedAt;callbacks.onExecutionStarted?.({role:'root'});this.emit(session,callbacks);},onProgress:progress=>{session.actor.detail=progress.detail||progress.summary||session.actor.detail;session.actor.updatedAt=nowIso();this.emit(session,callbacks);}}));
      session.rootTurnCount+=1;const completedAt=nowIso();session.actor.status=WorkUnitStatus.COMPLETED;session.actor.detail='本轮 Root 判断已形成。';session.actor.completedAt=completedAt;session.actor.updatedAt=completedAt;this.emit(session,callbacks);return decision;
    }catch(error){if(session.cancelRequested&&isInterrupted(error))return{kind:'cancelled'};throw error;}finally{session.rootController=null;}
  }

  async reviewRootDecision(task,session,decision,callbacks,{humanGatewayHistory=[],rootInputs=[],triggerRefs=[],synthesizeHumanGapResolution=true}={}){
    if(!this.validatorRuntime){
      if(hasGovernedCandidateDelta(decision)){const error=new Error('VALIDATOR_RUNTIME_REQUIRED: governed Candidate Delta cannot bypass Validator ownership.');error.nonRetryable=true;throw error;}
      return{decision,commits:[]};
    }
    decision=humanGatewayTransitionCandidate(decision,humanGatewayHistory,session.analysisState,{includeGapResolution:synthesizeHumanGapResolution});
    const reviewed=this.validatorRuntime.reviewRoot({decision,policyContext:this.governanceCompiler?.compileForRole?.(task,'validator')||session.policyContext,seenKnowledgeKeys:session.certifiedKnowledgeKeys,task,humanGatewayHistory,currentState:session.analysisState,availableEvidence:rootInputEvidence(rootInputs)});
    if(reviewed.outcome!=='pass')throw validationError(reviewed.feedback||[]);

    const workTriggerRefs=(Array.isArray(rootInputs)?rootInputs:[]).map(item=>text(item?.delegationId||item?.workUnit?.id)).filter(Boolean).map(id=>`work:${id}`);
    const certifiedTriggerRefs=[...new Set([...(Array.isArray(triggerRefs)?triggerRefs:[]),...workTriggerRefs].map(text).filter(Boolean))];
    if(!certifiedTriggerRefs.length){const error=new Error('ROOT_TURN_WITHOUT_TRIGGER: Current Certified State is context, not a trigger for another Root Turn.');error.nonRetryable=true;throw error;}

    const beforeCertifiedState=session.analysisState,prepared=applyCertifiedDelta(beforeCertifiedState,reviewed.decision,{triggerRefs:certifiedTriggerRefs});
    for(const gateway of Array.isArray(humanGatewayHistory)?humanGatewayHistory:[]){
      const gatewayId=text(gateway?.id),targetGapId=text(gateway?.targetGapId??gateway?.target_gap_id);if(!gatewayId||!targetGapId||gateway?.status!=='RESOLVED')continue;
      const beforeOpen=Boolean(beforeCertifiedState?.current?.gaps?.some?.(gap=>text(gap?.id)===targetGapId)),afterOpen=Boolean(prepared?.current?.gaps?.some?.(gap=>text(gap?.id)===targetGapId));
      recordTaskDiagnostic('human-gap-proof-result',{taskId:task.id,gatewayId,targetGapId,proofAttempted:Boolean(synthesizeHumanGapResolution&&beforeOpen),resolved:beforeOpen&&!afterOpen,gapStillOpen:afterOpen});
    }

    const historyCommit=prepared.turnNode?.historyCommit?clone(prepared.turnNode.historyCommit):null;
    const workReceiptIds=(Array.isArray(rootInputs)?rootInputs:[]).map(item=>text(item?.delegationId||item?.workUnit?.id)).filter(Boolean);
    if(prepared.turnNode){
      const commitPayload={analysisState:prepared.state,turnNode:prepared.turnNode,historyCommit:historyCommit?{...historyCommit,completedAt:prepared.turnNode.committedAt}:null,workReceiptIds};
      if(callbacks.onCertifiedTurn)callbacks.onCertifiedTurn(commitPayload);else if(historyCommit)this.commitProgress(session,callbacks,[historyCommit]);
      session.analysisState=prepared.state;session.certifiedContext=prepared.state.current;session.certifiedKnowledgeKeys=knowledgeKeysFromState(prepared.state);
      if(historyCommit){session.lastCommittedStageResult=historyCommit.detail;session.committedProgressKeys.add(`${historyCommit.title}\n${historyCommit.detail}`);}
    }else if(workReceiptIds.length)callbacks.onWorkReceiptsConsumed?.(workReceiptIds);

    const blockingGap=prepared.current.gaps?.find?.(gap=>gap?.blocking===true),stateFeedback=(prepared.issues||[]).map(issue=>({ruleId:'C-003',target:issue.target||'state',reason:issue.reason,action:issue.code}));
    const gatewayWithoutBlocker=reviewed.decision?.kind==='human_gateway'&&!blockingGap,gatewayGapId=text(reviewed.decision?.gateway?.gapId),gatewayGap=(prepared.current.gaps||[]).find(gap=>text(gap?.id)===gatewayGapId)||null;
    const normalizeQuestion=value=>text(value).replace(/\s+/g,' ');
    const gatewayBindingConflict=reviewed.decision?.kind==='human_gateway'&&Boolean(!gatewayGapId||!gatewayGap||gatewayGap.blocking!==true||normalizeQuestion(reviewed.decision?.gateway?.question)!==normalizeQuestion(gatewayGap?.question));
    const stateTransitionConflict=(prepared.issues||[]).length>0;
    const requiresRootDecision=Boolean(reviewed.requiresRootDecision||(reviewed.decision?.kind==='complete'&&(blockingGap||stateTransitionConflict))||gatewayWithoutBlocker||gatewayBindingConflict);
    if(blockingGap)stateFeedback.push({ruleId:'C-004',target:'blocking-gap',reason:`当前认证状态仍存在阻塞 Gap：${blockingGap.question}`,action:'HANDOFF_ROOT_CONTROL_DECISION'});
    if(stateTransitionConflict)stateFeedback.push({ruleId:'C-003',target:'state-transition',reason:'候选内容与已认证状态转换冲突；Root 必须重新决定控制动作。',action:'HANDOFF_ROOT_CONTROL_DECISION'});
    if(gatewayWithoutBlocker)stateFeedback.push({ruleId:'C-004',target:'human-gateway',reason:'当前没有 blocking Gap；Human Gateway 不能用于请求采用默认假设。',action:'HANDOFF_ROOT_CONTROL_DECISION'});
    if(gatewayBindingConflict)stateFeedback.push({ruleId:'C-004',target:'human-gateway-binding',reason:'Human Gateway 必须绑定当前 blocking Gap 且 question 与认证问题一致。',action:'HANDOFF_ROOT_CONTROL_DECISION'});
    return{decision:normalizeDecision(reviewed.decision),commits:historyCommit?[historyCommit]:[],feedback:[...(Array.isArray(reviewed.feedback)?reviewed.feedback:[]),...stateFeedback],actions:[...(Array.isArray(reviewed.actions)?reviewed.actions:[]),...(prepared.issues||[]).map(issue=>({action:issue.code,target:issue.target}))],requiresRootDecision,turnNode:prepared.turnNode};
  }

  buildWorkUnits(stage,delegations){
    const existingIds=new Set((stage?.workUnits||[]).map(unit=>unit.id));
    return(Array.isArray(delegations)?delegations:[]).map((d,index)=>{
      const id=String(d.id),deps=Array.isArray(d.dependsOn)?[...new Set(d.dependsOn.map(String))].filter(x=>x!==id):[];
      const waitingOnDependency=deps.some(dep=>{const prior=stage?.workUnits?.find(unit=>unit.id===dep);return !prior||prior.status!==WorkUnitStatus.COMPLETED;}),issuedAt=nowIso();
      return{id,title:String(d.title||`工作 ${index+1}`),goal:String(d.goal||''),expectedOutput:String(d.expectedOutput||''),stopCondition:String(d.stopCondition||''),projectAccess:['read','write'].includes(d.projectAccess)?d.projectAccess:'none',networkAccess:d.networkAccess===true,inputRefs:Array.isArray(d.inputRefs)?[...d.inputRefs]:[],skillId:d.skillId||null,dependsOn:deps,status:waitingOnDependency?WorkUnitStatus.WAITING_DEPENDENCY:WorkUnitStatus.WAITING_RESOURCE,detail:waitingOnDependency?'等待前置工作完成后继续。':'工作已就绪，等待可用 Agent。',issuedAt,startedAt:null,updatedAt:issuedAt,completedAt:null,failureCount:0,nextRetryAt:Date.now(),result:null,owner:null,effectRecoveryRequired:false};
    }).filter(unit=>!existingIds.has(unit.id));
  }
  createStage(session,delegations){const stage={id:`stage-${session.round+1}`,title:'当前工作',startedAt:nowIso(),workUnits:[]};stage.workUnits.push(...this.buildWorkUnits(stage,delegations));session.currentStage=stage;return stage;}
  appendToStage(session,delegations){if(!session.currentStage)return this.createStage(session,delegations);const additions=this.buildWorkUnits(session.currentStage,delegations);session.currentStage.workUnits.push(...additions);this.updateWaitingStates(session.currentStage);return additions;}
  hasUnfinishedWork(session){return Boolean(session.currentStage?.workUnits?.some(unit=>unit.status!==WorkUnitStatus.COMPLETED));}
  consumeRootInputs(session,rootInputs=[]){const ids=new Set((Array.isArray(rootInputs)?rootInputs:[]).map(item=>text(item?.delegationId||item?.workUnit?.id)).filter(Boolean));if(ids.size)session.subagentResults=session.subagentResults.filter(item=>!ids.has(text(item?.delegationId||item?.workUnit?.id)));}
  depsCompleted(stage,unit){return unit.dependsOn.every(id=>stage.workUnits.find(x=>x.id===id)?.status===WorkUnitStatus.COMPLETED);}
  hasSuspendedDependency(stage,unit){return unit.dependsOn.some(id=>stage.workUnits.find(x=>x.id===id)?.status===WorkUnitStatus.SUSPENDED);}
  updateWaitingStates(stage){for(const unit of stage.workUnits){if(unit.status!==WorkUnitStatus.WAITING_DEPENDENCY)continue;if(this.hasSuspendedDependency(stage,unit))unit.detail='前置工作已挂起；等待该工作重新执行成功后继续。';else if(this.depsCompleted(stage,unit)){unit.status=WorkUnitStatus.WAITING_RESOURCE;unit.nextRetryAt=Date.now();unit.detail='前置工作已完成，等待可用 Agent。';unit.updatedAt=nowIso();}}}

  startSubagent(task,session,unit,callbacks){
    unit.status=WorkUnitStatus.WAITING_RESOURCE;unit.owner=null;unit.effectRecoveryRequired=false;unit.detail=unit.failureCount?`正在准备第 ${unit.failureCount+1}/${MAX_TOTAL_ATTEMPTS} 次尝试。`:'工作已就绪，正在获取可用 Subagent。';unit.updatedAt=nowIso();
    const controller=new AbortController();session.runningControllers.set(unit.id,controller);this.emit(session,callbacks);
    const dependencyResults=unit.dependsOn.map(id=>{const dep=session.currentStage?.workUnits.find(x=>x.id===id);return dep?.result?{id,title:dep.title,result:dep.result}:null;}).filter(Boolean);
    const workUnit={id:unit.id,title:unit.title,goal:unit.goal,expectedOutput:unit.expectedOutput,stopCondition:unit.stopCondition,projectAccess:unit.projectAccess||'none',networkAccess:unit.networkAccess===true,skillId:unit.skillId,dependsOn:[...(unit.dependsOn||[])],inputRefs:[...(unit.inputRefs||[])]};
    const effectCapable=workMayMutate(workUnit),effectAttemptId=effectCapable?`effect:${task.id}:${unit.id}:${unit.failureCount+1}:${Date.now()}`:null;let executionStarted=false,effectAttemptOpen=false;
    const clearSafeAdmission=()=>{if(!effectAttemptOpen||!effectAttemptId)return true;try{callbacks.onEffectAttemptCleared?.(effectAttemptId);effectAttemptOpen=false;return true;}catch(error){unit.status=WorkUnitStatus.SUSPENDED;unit.nextRetryAt=null;unit.effectRecoveryRequired=true;unit.detail=`恢复事实无法安全更新：${error?.message||error}`;unit.updatedAt=nowIso();return false;}};
    if(effectCapable){
      try{callbacks.onEffectAttempt?.({id:effectAttemptId,workUnitId:unit.id,signature:workSemanticSignature(workUnit),projectAccess:workUnit.projectAccess,networkAccess:workUnit.networkAccess,inputRefs:[...workUnit.inputRefs],admittedAt:nowIso(),reason:'effect-capable-work-admitted',resolved:false});effectAttemptOpen=true;}
      catch(error){unit.status=WorkUnitStatus.SUSPENDED;unit.nextRetryAt=null;unit.effectRecoveryRequired=true;unit.detail=`无法在现实操作前持久化恢复边界：${error?.message||error}`;unit.updatedAt=nowIso();session.runningControllers.delete(unit.id);this.emit(session,callbacks);return Promise.resolve();}
    }
    const promise=this.subagentRuntime.run(task,{...workUnit,dependencyResults},{signal:controller.signal,policyContext:this.governanceCompiler?.compileForRole?.(task,'subagent',{skillId:unit.skillId,workUnit:unit})||session.policyContext,onExecutionStarted:()=>{executionStarted=true;const startedAt=nowIso();unit.status=WorkUnitStatus.RUNNING;unit.owner='subagent';unit.detail=unit.failureCount?`正在进行第 ${unit.failureCount+1}/${MAX_TOTAL_ATTEMPTS} 次尝试。`:'正在执行分配的具体工作。';unit.startedAt=unit.startedAt||startedAt;unit.updatedAt=startedAt;callbacks.onExecutionStarted?.({role:'subagent',workUnitId:unit.id});this.emit(session,callbacks);},onProgress:progress=>{unit.owner='subagent';unit.detail=progress.detail||progress.summary||unit.detail;unit.updatedAt=nowIso();this.emit(session,callbacks);}})
      .then(result=>{unit.result=result;unit.status=WorkUnitStatus.COMPLETED;unit.owner='subagent';unit.effectRecoveryRequired=false;unit.detail=result?.result||'工作已完成。';unit.completedAt=nowIso();unit.updatedAt=unit.completedAt;const receipt={id:unit.id,signature:workSemanticSignature(workUnit),workUnit,result:clone(result),issued_at:unit.issuedAt||null,started_at:unit.startedAt||null,completed_at:unit.completedAt,...(effectAttemptId?{effectAttemptId}:{})};try{callbacks.onWorkReceipt?.(receipt);effectAttemptOpen=false;}catch(error){error.nonRetryable=true;error.workReceiptPersistence=true;throw error;}session.subagentResults.push({...result,workUnit});})
      .catch(error=>{
        if(session.cancelRequested&&isInterrupted(error)){if(effectCapable&&executionStarted){unit.status=WorkUnitStatus.SUSPENDED;unit.nextRetryAt=null;unit.effectRecoveryRequired=true;unit.detail='取消已请求；先前已开始的外部操作结果仍需核对。';unit.updatedAt=nowIso();}else clearSafeAdmission();return;}
        if(isCapacityUnavailable(error)&&!executionStarted){if(!clearSafeAdmission())return;const delay=capacityRetryDelayMs(this.retryDelaysMs);unit.owner=null;unit.status=WorkUnitStatus.WAITING_RESOURCE;unit.nextRetryAt=Date.now()+delay;unit.detail=capacityWaitingInstruction(error?.message||'');unit.updatedAt=nowIso();return;}
        if(effectCapable&&!executionStarted&&!clearSafeAdmission())return;
        unit.failureCount+=1;unit.owner='subagent';
        if(effectCapable&&executionStarted){unit.status=WorkUnitStatus.SUSPENDED;unit.nextRetryAt=null;unit.effectRecoveryRequired=true;unit.detail=`执行连接在现实操作可能发生后失去确定结果；已停止自动重放，需先核对当前现实。${error?.message?` ${error.message}`:''}`;unit.updatedAt=nowIso();return;}
        const policy=classifyRetry(error);if(!policy.retryable||unit.failureCount>=MAX_TOTAL_ATTEMPTS){unit.status=WorkUnitStatus.SUSPENDED;unit.nextRetryAt=null;unit.detail=suspendedInstruction(policy.reason,policy.message,unit.failureCount);}else{const delay=retryDelayMs(unit.failureCount,this.retryDelaysMs);unit.status=WorkUnitStatus.RETRY_WAIT;unit.nextRetryAt=Date.now()+delay;unit.detail=waitingRetryInstruction(policy.reason,policy.message,unit.failureCount,delay);}unit.updatedAt=nowIso();
      })
      .finally(()=>{session.runningControllers.delete(unit.id);session.runningPromises.delete(unit.id);this.emit(session,callbacks);});
    session.runningPromises.set(unit.id,promise);return promise;
  }

  async runStage(task,session,callbacks){
    const stage=session.currentStage;
    while(true){
      if(session.cancelRequested){for(const controller of session.runningControllers.values())controller.abort();if(session.runningPromises.size)await Promise.allSettled([...session.runningPromises.values()]);return{kind:'cancelled'};}
      this.updateWaitingStates(stage);
      const runningCount=stage.workUnits.filter(x=>x.status===WorkUnitStatus.RUNNING&&x.owner!=='validator').length;
      const pendingStarts=[...session.runningPromises.keys()].filter(id=>{const unit=stage.workUnits.find(item=>item.id===id);return[WorkUnitStatus.WAITING_RESOURCE,WorkUnitStatus.RETRY_WAIT].includes(unit?.status);}).length;
      const slots=Math.max(0,this.effectiveConcurrency()-runningCount-pendingStarts);
      const ready=stage.workUnits.filter(unit=>[WorkUnitStatus.WAITING_RESOURCE,WorkUnitStatus.RETRY_WAIT].includes(unit.status)&&!session.runningPromises.has(unit.id)&&(unit.nextRetryAt||0)<=Date.now());
      const started=ready.slice(0,slots).map(unit=>this.startSubagent(task,session,unit,callbacks));
      if(started.length){await Promise.race(started.map(p=>p.catch(()=>null)));continue;}
      const runningPromises=[...session.runningPromises.values()];
      if(runningPromises.length){
        const nextRetryAt=stage.workUnits.filter(x=>[WorkUnitStatus.WAITING_RESOURCE,WorkUnitStatus.RETRY_WAIT].includes(x.status)&&!session.runningPromises.has(x.id)&&x.nextRetryAt).map(x=>Number(x.nextRetryAt)).filter(Number.isFinite).sort((a,b)=>a-b)[0];
        const waits=runningPromises.map(p=>p.catch(()=>null));if(nextRetryAt){const delay=Math.max(0,nextRetryAt-Date.now());waits.push(new Promise(resolveWait=>{const timer=setTimeout(resolveWait,delay);timer.unref?.();}));}await Promise.race(waits);continue;
      }
      if(stage.workUnits.every(x=>x.status===WorkUnitStatus.COMPLETED)){
        const completedUnits=stage.workUnits.map(unit=>({title:unit.title,detail:unit.detail,completedAt:unit.completedAt||unit.updatedAt}));callbacks.onStageCompleted?.(completedUnits);session.completedWorkUnits.push(...stage.workUnits.map(unit=>snapshotWorkUnit(unit,stage.id)));session.currentStage=null;session.round+=1;this.emit(session,callbacks);return{kind:'stage_complete'};
      }
      const suspended=stage.workUnits.filter(x=>x.status===WorkUnitStatus.SUSPENDED);if(suspended.length)return{kind:'suspended',reason:`${suspended.length} 项工作已挂起`,snapshot:this.makeSnapshot(session)};
      const future=stage.workUnits.filter(x=>[WorkUnitStatus.WAITING_RESOURCE,WorkUnitStatus.RETRY_WAIT].includes(x.status)&&x.nextRetryAt).map(x=>x.nextRetryAt);
      if(future.length){const retrying=stage.workUnits.some(x=>x.status===WorkUnitStatus.RETRY_WAIT&&x.nextRetryAt);return{kind:retrying?'retry_wait':'waiting_resource',retryAt:Math.min(...future),snapshot:this.makeSnapshot(session),reason:retrying?'等待自动重试':'等待执行资源恢复'};}
      return{kind:'suspended',reason:'当前工作无法继续推进',snapshot:this.makeSnapshot(session)};
    }
  }

  async execute(task,{humanGatewayHistory=[],onProgress=null,onStageCompleted=null,onProgressCommit=null,onCertifiedTurn=null,onTaskContractAuthority=null,onWorkReceipt=null,onWorkReceiptsConsumed=null,onEffectAttempt=null,onEffectAttemptCleared=null,onExecutionStarted=null}={}){
    const session=this.sessions.get(task.id)||this.createSession(task);session.cancelRequested=false;
    const callbacks={onProgress,onStageCompleted,onProgressCommit,onCertifiedTurn,onTaskContractAuthority,onWorkReceipt,onWorkReceiptsConsumed,onEffectAttempt,onEffectAttemptCleared,onExecutionStarted};
    const newlyResolvedHuman=(Array.isArray(humanGatewayHistory)?humanGatewayHistory:[]).filter(g=>g?.status==='RESOLVED'&&text(g?.id)&&!session.consumedHumanGatewayIds.has(text(g.id)));
    let invocationTriggerRefs=newlyResolvedHuman.map(g=>`human:${text(g.id)}`);
    if(!invocationTriggerRefs.length){const reason=text(task?.ready_reason);if(session.rootTurnCount===0&&!reason)invocationTriggerRefs=[`task:${task.id}`];else if(reason==='NEW')invocationTriggerRefs=[`task:${task.id}`];else if(reason==='RETRY_WAIT')invocationTriggerRefs=[`technical:retry:${task.id}`];else if(reason==='WAITING_RESOURCE')invocationTriggerRefs=[`technical:resource-resume:${task.id}`];else if(reason==='SUSPENDED')invocationTriggerRefs=[`technical:manual-resume:${task.id}`];else if(session.rootTurnCount===0)invocationTriggerRefs=[`task:${task.id}`];}
    let invocationTriggerConsumed=false;
    const capacityWait=async({title,detail,reason})=>{const delay=capacityRetryDelayMs(this.retryDelaysMs);session.actor={title,status:WorkUnitStatus.WAITING_RESOURCE,detail,updatedAt:nowIso(),owner:title.includes('Authority')?'validator':'root'};this.emit(session,callbacks);if(session.runningPromises.size){const timer=new Promise(resolveWait=>{const t=setTimeout(resolveWait,delay);t.unref?.();});await Promise.race([...session.runningPromises.values()].map(p=>p.catch(()=>null)).concat(timer));return null;}return{kind:'waiting_resource',retryAt:Date.now()+delay,snapshot:this.makeSnapshot(session),reason};};

    while(true){
      if(session.cancelRequested)return{kind:'cancelled',quiescent:this.isQuiescent(task.id)};
      const pendingValidation=session.pendingValidation,authorityResume=pendingValidation?.phase==='authority';
      if(!pendingValidation&&session.currentStage){const stageOutcome=await this.runStage(task,session,callbacks);if(stageOutcome.kind==='cancelled')return{kind:'cancelled',quiescent:this.isQuiescent(task.id)};if(stageOutcome.kind!=='stage_complete')return{...stageOutcome,quiescent:this.isQuiescent(task.id)};}

      let decision,rootInputs=pendingValidation?.rootInputs||session.subagentResults.slice(),rootTriggerRefs=Array.isArray(pendingValidation?.triggerRefs)?[...pendingValidation.triggerRefs]:[];session.pendingValidation=null;
      if(rootInputs.length&&!rootTriggerRefs.length)rootTriggerRefs=rootInputs.map(item=>text(item?.delegationId||item?.workUnit?.id)).filter(Boolean).map(id=>`work:${id}`);

      if(authorityResume){decision=pendingValidation.decision;rootInputs=[];session.actor={title:'Requirement Authority 认证',status:WorkUnitStatus.WAITING_RESOURCE,detail:'Root 的 Work 计划已保留；等待 Authority 核对同一能力请求。',updatedAt:nowIso(),owner:'validator'};this.emit(session,callbacks);}
      else if(pendingValidation?.phase==='authority_handoff'){
        rootInputs=[];session.actor={title:'Root 控制决策',status:WorkUnitStatus.WAITING_RESOURCE,detail:'来源边界已核对；等待 Root 基于已认证状态选择下一动作。',updatedAt:nowIso(),owner:'root'};this.emit(session,callbacks);
        try{decision=await this.runRootTurn(task,session,callbacks,{humanGatewayHistory:humanHistoryForTriggerRefs(humanGatewayHistory,rootTriggerRefs),validationFeedback:pendingValidation.feedback||[],previousDecision:pendingValidation.decision,rootInputs:[],authorityHandoff:true,activityKind:'control'});}catch(error){if(isCapacityUnavailable(error)){session.pendingValidation=pendingValidation;const outcome=await capacityWait({title:'Root 控制决策',detail:'已认证状态已保留；等待 Root 资源。',reason:'等待 Root 控制资源恢复'});if(outcome)return outcome;continue;}throw error;}
      }else{
        if(rootInputs.length){session.completionFeedback=null;session.completionRepairCount=0;session.completionTriggerRefs=[];}
        if(!rootInputs.length){if(session.completionFeedback?.length&&session.completionTriggerRefs?.length)rootTriggerRefs=[...session.completionTriggerRefs];else{if(invocationTriggerConsumed||!invocationTriggerRefs.length){const error=new Error('ROOT_TURN_WITHOUT_TRIGGER: no Task/Human/Subagent/technical trigger exists for another ordinary Root Turn.');error.nonRetryable=true;throw error;}rootTriggerRefs=[...invocationTriggerRefs];invocationTriggerConsumed=true;}}
        const activityKind=rootInputs.length?'synthesis':session.completionFeedback?.length?'completion_repair':session.rootTurnCount===0?'initial':'triggered';
        try{decision=await this.runRootTurn(task,session,callbacks,{humanGatewayHistory:humanHistoryForTriggerRefs(humanGatewayHistory,rootTriggerRefs),rootInputs,validationFeedback:session.completionFeedback?.length?session.completionFeedback:null,activityKind});}catch(error){if(isCapacityUnavailable(error)&&(rootInputs.length||session.currentStage)){const outcome=await capacityWait({title:'Root 综合结果',detail:'Work Unit 批次结果已保留；等待 Root 资源。',reason:'等待 Root 综合资源恢复'});if(outcome)return outcome;continue;}throw error;}
      }
      if(decision.kind==='cancelled')return{kind:'cancelled',quiescent:this.isQuiescent(task.id)};

      const reviewed=authorityResume?{decision,commits:[],requiresRootDecision:false}:await this.reviewRootDecision(task,session,decision,callbacks,{humanGatewayHistory:humanHistoryForTriggerRefs(humanGatewayHistory,rootTriggerRefs),rootInputs,triggerRefs:rootTriggerRefs,synthesizeHumanGapResolution:pendingValidation?.phase!=='authority_handoff'});
      decision=reviewed.decision;
      if(!authorityResume){consumeHumanTriggerRefs(session,rootTriggerRefs);this.consumeRootInputs(session,rootInputs);if(rootInputs.length)session.controlHandoffCount=0;}
      if(reviewed.requiresRootDecision){if(pendingValidation?.phase==='authority_handoff'||session.controlHandoffCount>=1){const error=new Error('ROOT_CONTROL_NON_CONVERGENCE: certified state still requires a different control decision without new evidence.');error.nonRetryable=true;throw error;}session.controlHandoffCount+=1;session.pendingValidation={phase:'authority_handoff',decision,feedback:reviewed.feedback||[],rootInputs:[],triggerRefs:rootTriggerRefs};session.actor={title:'来源边界已核对',status:WorkUnitStatus.COMPLETED,detail:'控制判断交回 Root。',updatedAt:nowIso(),owner:'validator'};this.emit(session,callbacks);continue;}
      if(decision.kind!=='complete'){session.completionFeedback=null;session.completionRepairCount=0;session.completionTriggerRefs=[];}
      if(this.hasUnfinishedWork(session)&&(decision.kind==='complete'||decision.kind==='human_gateway'))continue;

      if(decision.kind==='delegate'){
        if(!decision.delegations.length)throw invalidDelegationPlan(['delegate 决策必须至少包含一个 Work Unit。']);
        const knownWorkIds=session.currentStage?.workUnits?.map(unit=>unit.id)||[],plan=validateDelegationPlan(decision.delegations,{knownWorkIds,availableInputRefs:taskInputRefs(task)}),batchSignatures=new Set();
        for(const item of plan.delegations){const signature=workSemanticSignature(item);if(batchSignatures.has(signature)){plan.issues.push(`同一 Root 决策重复创建了语义相同的工作：${item.title||item.id}。`);plan.valid=false;}else if(session.issuedWorkSignatures.has(signature)){plan.issues.push(`工作 ${item.title||item.id} 与当前 Task 已创建的工作语义重复。`);plan.valid=false;}batchSignatures.add(signature);if(item.skillId&&this.governanceCompiler?.hasSkill&&!this.governanceCompiler.hasSkill(item.skillId)){plan.issues.push(`工作 ${item.id} 选择了不存在的 Skill：${item.skillId}。`);plan.valid=false;}}
        if(!plan.valid)throw invalidDelegationPlan(plan.issues);
        try{task=await this.certifyWorkAuthority(task,session,callbacks,plan.delegations);}catch(error){if(isCapacityUnavailable(error)){session.pendingValidation={phase:'authority',decision,rootInputs:[],triggerRefs:[...rootTriggerRefs]};const outcome=await capacityWait({title:'Requirement Authority 认证',detail:'Root 的 Work 计划已保留；等待 Authority 资源。',reason:'等待 Requirement Authority 资源恢复'});if(outcome)return outcome;continue;}throw error;}
        if(this.governanceCompiler?.compileForRole){plan.delegations=plan.delegations.map(item=>{const grant=this.governanceCompiler.compileForRole(task,'subagent',{skillId:item.skillId,workUnit:item})?.authorizedGrant;if(!grant){plan.issues.push(`工作 ${item.id} 缺少 AuthorizedGrant。`);plan.valid=false;return item;}const required=requiredWorkCapabilities(item);if(!capabilitiesSatisfy(required,grant)){plan.issues.push(`工作 ${item.id} 的 Required Work Semantics 超过 AuthorizedGrant。`);plan.valid=false;return item;}return{...item,projectAccess:text(grant.projectAccess||'none'),networkAccess:grant.networkAccess===true,inputRefs:Array.isArray(grant.inputRefs)?[...grant.inputRefs]:[]};});}else for(const item of plan.delegations)if(item.projectAccess!=='none'||item.networkAccess===true||item.inputRefs.length){plan.issues.push(`工作 ${item.id} 请求受治理能力但没有 GovernanceCompiler。`);plan.valid=false;}
        if(!plan.valid)throw invalidDelegationPlan(plan.issues);
        for(const item of plan.delegations)session.issuedWorkSignatures.add(workSemanticSignature(item));if(session.currentStage)this.appendToStage(session,plan.delegations);else this.createStage(session,plan.delegations);this.emit(session,callbacks);continue;
      }

      if(decision.kind==='human_gateway'){
        if(!decision.gateway?.question?.trim()){const error=new Error('ROOT_INVALID_HUMAN_GATEWAY');error.nonRetryable=true;throw error;}
        const snapshot=this.makeSnapshot(session);this.discardSession(task.id);return{kind:'needs_human',gateway:{...decision.gateway,targetGapId:decision.gateway.gapId||null},summary:decision.summary,stageResult:session.lastCommittedStageResult,snapshot,quiescent:true};
      }

      if(decision.kind==='complete'){
        const finalView=decision.resultMode==='analysis'?decisionFromCertifiedState(session.analysisState,decision):null,finalResult=finalView?renderAnalysisResult(finalView):composeExecutionResult(decision),finalSummary=finalView?canonicalAnalysisSummary(finalView):decision.summary,stageResult=session.lastCommittedStageResult||null,proposal={finalResult,summary:finalSummary,stageResult};
        if(!this.completionEvaluator){const error=new Error('COMPLETION_EVALUATOR_REQUIRED');error.nonRetryable=true;throw error;}
        let assessments=[];if(this.completionAssessmentVerifier){const verified=await this.completionAssessmentVerifier.review({task,proposal,certifiedContext:session.certifiedContext});assessments=Array.isArray(verified?.assessments)?verified.assessments:[];}
        const evaluated=this.completionEvaluator.evaluate({taskContract:task.taskContract,certifiedAssessments:assessments});
        if(evaluated?.goalState==='satisfied'){session.completionFeedback=null;session.completionRepairCount=0;session.completionTriggerRefs=[];this.discardSession(task.id);return{kind:'goal_satisfied',goalState:evaluated.goalState,proposal,assessments,quiescent:true};}
        const unsatisfied=Array.isArray(evaluated?.unsatisfiedObligationIds)?evaluated.unsatisfiedObligationIds:[];
        if(session.completionRepairCount>=1){const error=new Error(`ROOT_COMPLETION_NON_CONVERGENCE: governed obligations remain unsatisfied${unsatisfied.length?`: ${unsatisfied.join(', ')}`:''}`);error.nonRetryable=true;throw error;}
        session.completionRepairCount=1;session.completionFeedback=[{ruleId:'D-018',target:'completion',reason:`CompletionEvaluator reports unsatisfied obligations${unsatisfied.length?`: ${unsatisfied.join(', ')}`:''}.`,action:'REVISE_CONTROL_DECISION'}];session.completionTriggerRefs=[...rootTriggerRefs];continue;
      }

      const error=new Error('ROOT_INVALID_DECISION');error.nonRetryable=true;throw error;
    }
  }
}
