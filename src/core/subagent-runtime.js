import { SourceTraceVerifier } from '../governance/source-trace-verifier.js';
import { competingEffectAttempts } from './effect-recovery.js';
import { failWorkUnitObservability, finalizeWorkUnitObservability } from './work-unit-observability.js';
import { scopeTaskInputs } from './task-input-scope.js';
import { workMayMutate } from './work-capability.js';

function text(value){return String(value==null?'':value).trim();}
function strings(values){return [...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];}

function normalizeEffectActuationClosure(value,task,delegation,evidence=[]){
  const attempts=competingEffectAttempts(task?.executionState);
  if(task?.executionState?.retry?.scope!=='effect-recovery-observe'||attempts.length!==1||workMayMutate(delegation)||!value||typeof value!=='object')return null;
  const expectedAttemptId=text(attempts[0]?.id),claimedAttemptId=text(value?.effectAttemptId);
  if(!expectedAttemptId||(claimedAttemptId&&claimedAttemptId!==expectedAttemptId)||value.terminal!==true||value.canMutate!==false)return null;
  const directEvidenceIds=new Set((Array.isArray(evidence)?evidence:[]).filter(item=>item?.strength==='direct').map(item=>text(item?.id)).filter(Boolean)),evidenceIds=strings(value.evidenceIds);
  if(!evidenceIds.length||evidenceIds.some(id=>!directEvidenceIds.has(id)))return null;
  return {effectAttemptId:expectedAttemptId,terminal:true,canMutate:false,evidenceIds};
}

function blockedDependency(delegation){return (Array.isArray(delegation?.dependencyResults)?delegation.dependencyResults:[]).find(item=>text(item?.result?.blocker));}
function unmetDependencyResult(delegation,dependency){const dependencyId=text(dependency?.id)||'unknown';return{delegationId:text(delegation?.id),result:`前置 Work Unit ${dependencyId} 未满足工作契约；当前依赖 Work Unit 未执行。`,evidence:[],blocker:`WORK_UNIT_DEPENDENCY_UNSATISFIED: 前置 Work Unit ${dependencyId} 未满足工作契约。`};}

export class SubagentRuntime{
  constructor({executor,modelRouter,sourceTraceVerifier=new SourceTraceVerifier()}){this.executor=executor;this.modelRouter=modelRouter;this.sourceTraceVerifier=sourceTraceVerifier;}

  async run(task,delegation,{onProgress=null,onExecutionStarted=null,signal=null,policyContext=null}={}){
    const dependencyBlocker=blockedDependency(delegation);if(dependencyBlocker)return unmetDependencyResult(delegation,dependencyBlocker);
    const scopedTask=scopeTaskInputs(task,delegation?.inputRefs),diagnosticIdentity={taskId:scopedTask?.id||task?.id||null,workUnitId:delegation?.id||null};
    await this.modelRouter.prepare?.({role:'subagent',task:scopedTask,work:delegation});
    let raw;
    try{raw=await this.executor.runSubagent({task:scopedTask,delegation,modelPolicy:this.modelRouter.route({role:'subagent',task:scopedTask,work:delegation}),policyContext,onProgress,onExecutionStarted,signal});}
    catch(error){try{failWorkUnitObservability({...diagnosticIdentity,status:error?.interrupted?'interrupted':'failed',blocker:error?.message||String(error)});}catch{/* diagnostics only */}throw error;}

    const evidence=Array.isArray(raw?.evidence)?raw.evidence:[];
    let closureEvidence=evidence;
    if(raw?.effectActuationClosure){
      try{const traced=this.sourceTraceVerifier.enforce({task:scopedTask,evidence,humanGatewayHistory:[]});closureEvidence=Array.isArray(traced.evidence)?traced.evidence:[];}
      catch(error){try{failWorkUnitObservability({...diagnosticIdentity,status:'recovery-evidence-verification-failed',blocker:error?.message||String(error)});}catch{/* diagnostics only */}throw error;}
    }
    const effectActuationClosure=normalizeEffectActuationClosure(raw?.effectActuationClosure,task,delegation,closureEvidence),blocker=text(raw?.blocker)||null;
    try{finalizeWorkUnitObservability({...diagnosticIdentity,evidence,status:'completed',blocker});}catch{/* diagnostics only */}
    return{delegationId:text(delegation?.id),result:text(raw?.result),evidence,blocker,...(effectActuationClosure?{effectActuationClosure}:{})};
  }
}
