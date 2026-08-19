import { RootRuntime } from './root-runtime.js';
import { recordTaskDiagnostic } from './runtime-diagnostic.js';
import { taskInputCatalog } from './task-input-scope.js';

const instrumentedExecutors=new WeakSet();

function debugEnabled(){return String(process.env.TASKBOARD_LOG_LEVEL||'info').trim().toLowerCase()==='debug';}
function emitDebug(event,data={}){if(debugEnabled())recordTaskDiagnostic(event,data);}
function bytes(value){try{if(value==null)return 0;return Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value),'utf8');}catch{return null;}}
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
function workUnitIds(rootInputs=[]){return[...new Set(list(rootInputs).map(item=>text(item?.delegationId||item?.workUnit?.id)).filter(Boolean))];}
function triggerType(activityKind,{rootInputs=[],humanGatewayHistory=[]}={}){
  if(list(rootInputs).length)return'work_results';
  if(list(humanGatewayHistory).length)return'human_gateway';
  if(activityKind==='initial')return'task';
  return'resume';
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
  const kind=text(reviewed?.decision?.kind);
  if(kind==='delegate')return'work_stage';
  if(kind==='human_gateway')return'human_gateway';
  if(kind==='complete')return'completion_evaluation';
  if(kind==='cancelled')return'cancelled';
  return kind||'unknown';
}

export function rootPromptComponents(request,prompt){
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
    humanGatewayBytes:bytes(request?.humanGatewayHistory||[]),
    skillCatalogBytes:bytes(request?.policyContext?.skillCatalog||[]),
    totalPromptBytes:bytes(prompt),
  };
}

export function instrumentExecutorTelemetry(executor){
  if(!executor||(typeof executor!=='object'&&typeof executor!=='function')||instrumentedExecutors.has(executor))return executor;
  try{
    if(!Object.isExtensible(executor))return executor;
    const rootContexts=new Map();
    executor.setRootTelemetryContext=(taskId,context)=>{const id=text(taskId);if(id)rootContexts.set(id,context||null);};
    if(typeof executor.rootPrompt==='function'){
      const original=executor.rootPrompt;
      executor.rootPrompt=function(request={}){
        const prompt=original.call(this,request);
        try{const taskId=text(request?.task?.id)||null,context=taskId?rootContexts.get(taskId)||null:null;emitDebug('root-prompt-components',{taskId,...(context||{}),...rootPromptComponents(request,prompt)});if(taskId)rootContexts.delete(taskId);}catch{/* telemetry only */}
        return prompt;
      };
    }
    instrumentedExecutors.add(executor);
  }catch{/* telemetry is optional */}
  return executor;
}

export class InstrumentedRootRuntime extends RootRuntime{
  constructor(options={}){super(options);this.rootTelemetryByTask=new Map();this.loggedRootOutcomesByTask=new Map();}
  telemetryMap(taskId){const id=text(taskId);let map=this.rootTelemetryByTask.get(id);if(!map){map=new Map();this.rootTelemetryByTask.set(id,map);}return map;}
  loggedSet(taskId){const id=text(taskId);let set=this.loggedRootOutcomesByTask.get(id);if(!set){set=new Set();this.loggedRootOutcomesByTask.set(id,set);}return set;}
  discardSession(taskId){const result=super.discardSession(taskId);const id=text(taskId);this.rootTelemetryByTask.delete(id);this.loggedRootOutcomesByTask.delete(id);return result;}

  async runRootTurn(task,session,callbacks,options={}){
    const rootTurn=(Number(session?.rootTurnCount)||0)+1;
    const meta={rootTurn,activityKind:options?.activityKind||'initial',triggerType:triggerType(options?.activityKind||'initial',options),rootInputWorkUnitIds:workUnitIds(options?.rootInputs||[])};
    this.telemetryMap(task?.id).set(rootTurn,meta);
    try{this.executor?.setRootTelemetryContext?.(task?.id,meta);}catch{/* telemetry only */}
    emitDebug('root-turn-context',{taskId:task?.id||null,...meta,...certifiedCounts(session)});
    return super.runRootTurn(task,session,callbacks,options);
  }

  emitRootOutcome(task,reviewed,meta){
    if(!meta)return;const logged=this.loggedSet(task?.id);if(logged.has(meta.rootTurn))return;logged.add(meta.rootTurn);
    emitDebug('root-turn-outcome',{taskId:task?.id||null,rootTurn:meta.rootTurn,activityKind:meta.activityKind,triggerType:meta.triggerType,decisionKind:reviewed?.decision?.kind||null,...deltaCounts(reviewed),reviewOutcome:'pass',nextTurnReason:nextReasonFor(reviewed)});
  }

  async reviewRootDecision(task,session,decision,callbacks,options={}){
    const reviewed=await super.reviewRootDecision(task,session,decision,callbacks,options);
    try{const telemetry=this.telemetryMap(task?.id),meta=telemetry.get(Number(session?.rootTurnCount)||0);this.emitRootOutcome(task,reviewed,meta);}catch{/* telemetry only */}
    return reviewed;
  }
}
