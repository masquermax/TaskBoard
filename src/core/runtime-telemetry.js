import { RootRuntime } from './root-runtime.js';
import { recordTaskDiagnostic } from './runtime-diagnostic.js';
import { taskInputCatalog } from './task-input-scope.js';

const instrumentedExecutors=new WeakSet();
const instrumentedEvaluators=new WeakSet();

function debugEnabled(){
  return String(process.env.TASKBOARD_LOG_LEVEL||'info').trim().toLowerCase()==='debug';
}

function emitDebug(event,data={}){
  if(!debugEnabled())return;
  recordTaskDiagnostic(event,data);
}

function bytes(value){
  try{
    if(value==null)return 0;
    return Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value),'utf8');
  }catch{return null;}
}

function list(value){return Array.isArray(value)?value:[];}
function text(value){return String(value==null?'':value).trim();}

function certifiedCounts(session){
  const current=session?.certifiedContext||session?.analysisState?.current||{};
  return{
    certifiedStateVersion:Number.isFinite(Number(session?.analysisState?.version))?Number(session.analysisState.version):null,
    certifiedEvidenceCount:list(current?.evidence).length,
    certifiedClaimCount:list(current?.claims).length,
    certifiedGapCount:list(current?.gaps).length,
  };
}

function triggerType(activityKind,{rootInputs=[],humanGatewayHistory=[]}={}){
  if(activityKind==='completion_repair')return'completion_feedback';
  if(activityKind==='planning_repair')return'planning_feedback';
  if(activityKind==='rework')return'validator_feedback';
  if(activityKind==='control')return'authority_handoff';
  if(list(rootInputs).length)return'work_results';
  if(list(humanGatewayHistory).length)return'human_gateway';
  if(activityKind==='initial')return'task';
  return'unknown';
}

function workUnitIds(rootInputs=[]){
  return [...new Set(list(rootInputs).map(item=>text(item?.delegationId||item?.workUnit?.id)).filter(Boolean))];
}

function triggerRefsFor(task,session,{activityKind='initial',rootInputs=[],humanGatewayHistory=[]}={},overrideRefs=null){
  if(Array.isArray(overrideRefs)&&overrideRefs.length)return[...overrideRefs];
  const workIds=workUnitIds(rootInputs);
  if(workIds.length)return workIds.map(id=>`work:${id}`);
  if(activityKind==='completion_repair'&&list(session?.completionTriggerRefs).length)return[...session.completionTriggerRefs];
  if(activityKind==='planning_repair'&&list(session?.planningTriggerRefs).length)return[...session.planningTriggerRefs];
  const humanRefs=list(humanGatewayHistory).map(item=>text(item?.id)).filter(Boolean).map(id=>`human:${id}`);
  if(humanRefs.length)return humanRefs;
  if(activityKind==='initial'&&task?.id)return[`task:${task.id}`];
  return null;
}

function deltaCounts(reviewed){
  const delta=reviewed?.turnNode?.delta||null;
  return{
    newCertifiedEvidence:delta?list(delta.evidence).length:0,
    newCertifiedClaims:delta?list(delta.claims).length:0,
    newCertifiedGaps:delta?list(delta.gaps).length:0,
    resolvedCertifiedGaps:delta?list(delta.gapResolutions).length:0,
  };
}

function nextReasonFor(reviewed){
  if(reviewed?.requiresRootDecision)return'authority_handoff';
  const kind=text(reviewed?.decision?.kind);
  if(kind==='delegate')return'delegation_validation';
  if(kind==='human_gateway')return'human_gateway';
  if(kind==='complete')return'completion_evaluation';
  if(kind==='cancelled')return'cancelled';
  return kind||'unknown';
}

function rootPromptComponents(request,prompt){
  const task=request?.task||{};
  const refs=list(task.references).map(r=>({taskId:r?.source_task_id,title:r?.title,result:r?.final_result}));
  const completedWork=list(task.workReceipts).map(receipt=>({id:receipt?.id,title:receipt?.workUnit?.title||receipt?.id,goal:receipt?.workUnit?.goal||'',inputRefs:receipt?.workUnit?.inputRefs||[],projectAccess:receipt?.workUnit?.projectAccess||'none',networkAccess:receipt?.workUnit?.networkAccess===true,completedAt:receipt?.completed_at||null}));
  const certified=request?.certifiedContext||{};
  return{
    policyBytes:bytes(request?.policyContext?.prompt||''),
    taskInstructionBytes:bytes(task?.instruction||''),
    taskInputCatalogBytes:bytes(taskInputCatalog(task)),
    referencesBytes:bytes(refs),
    workReceiptsBytes:bytes(completedWork),
    lastStageResultBytes:bytes(task?.last_stage_result||''),
    newWorkResultsBytes:bytes(request?.subagentResults||[]),
    activeWorkBytes:bytes(request?.activeWork||[]),
    certifiedEvidenceBytes:bytes(certified?.evidence||[]),
    certifiedClaimsBytes:bytes(certified?.claims||[]),
    certifiedGapsBytes:bytes(certified?.gaps||[]),
    validatorFeedbackBytes:bytes(request?.validationFeedback||[]),
    previousCandidateBytes:bytes(request?.previousDecision||null),
    planningFeedbackBytes:bytes(request?.planningFeedback||[]),
    humanGatewayBytes:bytes(request?.humanGatewayHistory||[]),
    skillCatalogBytes:bytes(request?.policyContext?.skillCatalog||[]),
    totalPromptBytes:bytes(prompt),
  };
}

function validatorPromptComponents(request,prompt){
  const candidates=list(request?.candidates);
  const completionCandidates=candidates.filter(item=>item?.candidateType==='completion_assessment');
  const sample=completionCandidates[0]||null;
  const proofMaterial=list(sample?.proofMaterial);
  const proofEvidence=proofMaterial.filter(item=>!text(item?.level));
  const proofClaims=proofMaterial.filter(item=>text(item?.level));
  const requirementContextBytes=completionCandidates.length
    ? completionCandidates.reduce((sum,item)=>sum+(bytes(item?.requirementContext||[])||0),0)
    : null;
  const proposalRepeatedBytes=completionCandidates.length
    ? completionCandidates.reduce((sum,item)=>sum+(bytes(item?.proposal||null)||0),0)
    : null;
  const proofMaterialRepeatedBytes=completionCandidates.length
    ? completionCandidates.reduce((sum,item)=>sum+(bytes(item?.proofMaterial||[])||0),0)
    : null;
  return{
    validatorKind:completionCandidates.length?'completion':'semantic',
    obligationCount:list(request?.task?.taskContract?.obligations).length,
    candidateCount:candidates.length,
    completionCandidateCount:completionCandidates.length,
    proofMaterialEvidenceCount:sample?proofEvidence.length:null,
    proofMaterialClaimCount:sample?proofClaims.length:null,
    proofMaterialBytes:sample?bytes(proofMaterial):null,
    proofMaterialRepeatedBytes,
    requirementContextBytes,
    proposalBytes:sample?bytes(sample?.proposal||null):null,
    proposalRepeatedBytes,
    candidatePayloadBytes:bytes(candidates),
    totalValidatorBytes:bytes(prompt),
  };
}

export function instrumentExecutorTelemetry(executor){
  if(!executor||(typeof executor!=='object'&&typeof executor!=='function')||instrumentedExecutors.has(executor))return executor;
  try{
    if(!Object.isExtensible(executor))return executor;
    const rootContexts=new Map();
    executor.setRootTelemetryContext=(taskId,context)=>{
      const id=text(taskId);if(id)rootContexts.set(id,context||null);
    };

    if(typeof executor.rootPrompt==='function'){
      const original=executor.rootPrompt;
      executor.rootPrompt=function(request={}){
        const prompt=original.call(this,request);
        try{
          const taskId=text(request?.task?.id)||null;
          const context=taskId?rootContexts.get(taskId)||null:null;
          emitDebug('root-prompt-components',{taskId,...(context||{}),...rootPromptComponents(request,prompt)});
          if(taskId)rootContexts.delete(taskId);
        }catch{/* telemetry must never affect prompt production */}
        return prompt;
      };
    }

    if(typeof executor.validatorPrompt==='function'){
      const original=executor.validatorPrompt;
      executor.validatorPrompt=function(request={}){
        const prompt=original.call(this,request);
        try{emitDebug('validator-prompt-components',{taskId:text(request?.task?.id)||null,...validatorPromptComponents(request,prompt)});}catch{/* diagnostics only */}
        return prompt;
      };
    }
    instrumentedExecutors.add(executor);
  }catch{/* an immutable/custom Executor remains valid; telemetry is optional */}
  return executor;
}

export class InstrumentedRootRuntime extends RootRuntime{
  constructor(options={}){
    super(options);
    this.rootTelemetryByTask=new Map();
    this.loggedRootOutcomesByTask=new Map();
    this.reviewTriggerRefsByTask=new Map();
    this.pendingCompletionByContract=new Map();
    this.installCompletionTelemetry();
  }

  installCompletionTelemetry(){
    const evaluator=this.completionEvaluator;
    if(!evaluator||typeof evaluator.evaluate!=='function'||instrumentedEvaluators.has(evaluator))return;
    try{
      const original=evaluator.evaluate.bind(evaluator);
      const runtime=this;
      evaluator.evaluate=function(args={}){
        const result=original(args);
        try{
          const pending=runtime.pendingCompletionByContract.get(args?.taskContract);
          if(pending){
            runtime.pendingCompletionByContract.delete(args.taskContract);
            const unsatisfied=list(result?.unsatisfiedObligationIds);
            const nextTurnReason=result?.goalState==='satisfied'
              ? 'goal_satisfied'
              : pending.session?.completionRepairCount>=1?'completion_non_convergence':'completion_repair';
            runtime.emitRootOutcome(pending.task,pending.session,pending.reviewed,pending.meta,{nextTurnReason,completionGoalState:result?.goalState||null,unsatisfiedObligationIds:unsatisfied});
          }
        }catch{/* telemetry only */}
        return result;
      };
      instrumentedEvaluators.add(evaluator);
    }catch{/* telemetry must never make CompletionEvaluator unavailable */}
  }

  telemetryMap(taskId){
    const id=text(taskId);let map=this.rootTelemetryByTask.get(id);if(!map){map=new Map();this.rootTelemetryByTask.set(id,map);}return map;
  }
  loggedSet(taskId){
    const id=text(taskId);let set=this.loggedRootOutcomesByTask.get(id);if(!set){set=new Set();this.loggedRootOutcomesByTask.set(id,set);}return set;
  }

  discardSession(taskId){
    const result=super.discardSession(taskId);
    const id=text(taskId);
    this.rootTelemetryByTask.delete(id);
    this.loggedRootOutcomesByTask.delete(id);
    this.reviewTriggerRefsByTask.delete(id);
    for(const [contract,pending] of this.pendingCompletionByContract.entries())if(text(pending?.task?.id)===id)this.pendingCompletionByContract.delete(contract);
    return result;
  }

  async runRootTurn(task,session,callbacks,options={}){
    const rootTurn=(Number(session?.rootTurnCount)||0)+1;
    const overrideRefs=this.reviewTriggerRefsByTask.get(text(task?.id))||null;
    const refs=triggerRefsFor(task,session,options,overrideRefs);
    const meta={
      rootTurn,
      activityKind:options?.activityKind||'initial',
      triggerType:triggerType(options?.activityKind||'initial',options),
      triggerRefs:refs,
      rootInputWorkUnitIds:workUnitIds(options?.rootInputs||[]),
    };
    this.telemetryMap(task?.id).set(rootTurn,meta);
    try{this.executor?.setRootTelemetryContext?.(task?.id,meta);}catch{/* telemetry only */}
    emitDebug('root-turn-context',{taskId:task?.id||null,...meta,...certifiedCounts(session)});
    return super.runRootTurn(task,session,callbacks,options);
  }

  emitRootOutcome(task,session,reviewed,meta,extra={}){
    if(!meta)return;
    const logged=this.loggedSet(task?.id);
    if(logged.has(meta.rootTurn))return;
    logged.add(meta.rootTurn);
    const counts=deltaCounts(reviewed);
    emitDebug('root-turn-outcome',{
      taskId:task?.id||null,
      rootTurn:meta.rootTurn,
      activityKind:meta.activityKind,
      triggerType:meta.triggerType,
      decisionKind:reviewed?.decision?.kind||null,
      ...counts,
      reviewOutcome:reviewed?.requiresRootDecision?'handoff':'pass',
      requiresRootDecision:Boolean(reviewed?.requiresRootDecision),
      nextTurnReason:extra?.nextTurnReason||nextReasonFor(reviewed),
      ...(extra||{}),
    });
  }

  async reviewRootDecision(task,session,decision,callbacks,options={}){
    const taskId=text(task?.id);
    this.reviewTriggerRefsByTask.set(taskId,list(options?.triggerRefs));
    let reviewed;
    try{reviewed=await super.reviewRootDecision(task,session,decision,callbacks,options);}
    finally{this.reviewTriggerRefsByTask.delete(taskId);}

    try{
      const telemetry=this.telemetryMap(taskId);
      const logged=this.loggedSet(taskId);
      const pending=[...telemetry.entries()].filter(([turn])=>turn<=session.rootTurnCount&&!logged.has(turn)).sort((a,b)=>a[0]-b[0]);
      if(!pending.length)return reviewed;
      for(const [,meta] of pending.slice(0,-1)){
        this.emitRootOutcome(task,session,{decision,turnNode:null,requiresRootDecision:false},meta,{reviewOutcome:'rework',nextTurnReason:'validator_rework'});
      }
      const [,latestMeta]=pending[pending.length-1];
      if(reviewed?.requiresRootDecision){
        this.emitRootOutcome(task,session,reviewed,latestMeta,{nextTurnReason:'authority_handoff'});
      }else if(reviewed?.decision?.kind==='complete'){
        if(this.hasUnfinishedWork(session))this.emitRootOutcome(task,session,reviewed,latestMeta,{nextTurnReason:'waiting_for_work'});
        else if(task?.taskContract&&typeof task.taskContract==='object')this.pendingCompletionByContract.set(task.taskContract,{task,session,reviewed,meta:latestMeta});
        else this.emitRootOutcome(task,session,reviewed,latestMeta,{nextTurnReason:'completion_evaluation'});
      }else{
        this.emitRootOutcome(task,session,reviewed,latestMeta);
      }
    }catch{/* telemetry must never change review semantics */}
    return reviewed;
  }
}

export { rootPromptComponents, validatorPromptComponents };
