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
  const expectedAttemptId=text(attempts[0]?.id);
  const claimedAttemptId=text(value?.effectAttemptId);
  if(!expectedAttemptId||(claimedAttemptId&&claimedAttemptId!==expectedAttemptId)||value.terminal!==true||value.canMutate!==false)return null;
  const directEvidenceIds=new Set((Array.isArray(evidence)?evidence:[])
    .filter(item=>item?.strength==='direct')
    .map(item=>text(item?.id))
    .filter(Boolean));
  const evidenceIds=strings(value.evidenceIds);
  if(!evidenceIds.length||evidenceIds.some(id=>!directEvidenceIds.has(id)))return null;
  return {effectAttemptId:expectedAttemptId,terminal:true,canMutate:false,evidenceIds};
}

function boundedNonConvergence(delegation){
  return {
    delegationId:text(delegation?.id),
    result:'当前 Work Unit 在技术执行边界内未形成要求的执行输出。',
    evidence:[],
    blocker:'WORK_UNIT_NON_CONVERGENT: 当前 Work Unit 在技术执行边界内未满足停止条件；控制权交回 Root。',
  };
}

function blockedDependency(delegation){
  return (Array.isArray(delegation?.dependencyResults)?delegation.dependencyResults:[]).find(item=>text(item?.result?.blocker));
}

function unmetDependencyResult(delegation,dependency){
  const dependencyId=text(dependency?.id)||'unknown';
  return {
    delegationId:text(delegation?.id),
    result:`前置 Work Unit ${dependencyId} 未满足工作契约；当前依赖 Work Unit 未执行。`,
    evidence:[],
    blocker:`WORK_UNIT_DEPENDENCY_UNSATISFIED: 前置 Work Unit ${dependencyId} 未满足工作契约。`,
  };
}

export class SubagentRuntime {
  constructor({ executor, modelRouter, sourceTraceVerifier = new SourceTraceVerifier() }) {
    this.executor = executor;
    this.modelRouter = modelRouter;
    this.sourceTraceVerifier = sourceTraceVerifier;
  }

  async run(task, delegation, { onProgress = null, onExecutionStarted = null, signal = null, policyContext = null } = {}) {
    // Subagent executes one Root-issued Work Unit. Dependency interpretation and
    // any next Task decision belong to Root, so a blocked prerequisite ends this
    // Work Unit without another model/tool turn.
    const dependencyBlocker=blockedDependency(delegation);
    if(dependencyBlocker)return unmetDependencyResult(delegation,dependencyBlocker);

    const scopedTask = scopeTaskInputs(task, delegation?.inputRefs);
    const diagnosticIdentity={taskId:scopedTask?.id||task?.id||null,workUnitId:delegation?.id||null};
    await this.modelRouter.prepare?.({ role:'subagent', task:scopedTask, work:delegation });
    let raw;
    try {
      raw = await this.executor.runSubagent({
        task:scopedTask,
        delegation,
        validationFeedback:null,
        modelPolicy:this.modelRouter.route({ role:'subagent', task:scopedTask, work:delegation }),
        policyContext,
        onProgress,
        onExecutionStarted,
        signal,
      });
    } catch (error) {
      try{failWorkUnitObservability({...diagnosticIdentity,status:error?.executionBoundary?'execution-boundary':(error?.interrupted?'interrupted':'failed'),blocker:error?.message||String(error)});}catch{/* diagnostics only */}
      // The technical lease is only an execution fact. A read-only Work Unit that
      // reaches it returns that fact to Root; effect-capable Work keeps the stricter
      // recovery/suspension path because Reality may already have changed.
      if(error?.executionBoundary===true && !workMayMutate(delegation)) return boundedNonConvergence(delegation);
      throw error;
    }

    let evidence;
    try{
      const rawEvidence=Array.isArray(raw?.evidence)?raw.evidence:[];
      const traced=this.sourceTraceVerifier.enforce({task:scopedTask,evidence:rawEvidence,humanGatewayHistory:[]});
      evidence=Array.isArray(traced.evidence)?traced.evidence:[];
    }catch(error){
      try{failWorkUnitObservability({...diagnosticIdentity,status:'evidence-verification-failed',blocker:error?.message||String(error)});}catch{/* diagnostics only */}
      throw error;
    }

    const effectActuationClosure=normalizeEffectActuationClosure(raw?.effectActuationClosure,task,delegation,evidence);
    const blocker=text(raw?.blocker)||null;

    // Observability records execution facts only. It cannot create a Finding,
    // Task Claim, Gap, recommendation or next action.
    try {
      finalizeWorkUnitObservability({
        ...diagnosticIdentity,
        evidence,
        status:'completed',
        blocker,
      });
    } catch { /* diagnostics must never affect Work Unit semantics */ }

    // Runtime allow-list: Subagent is hands, not the Task brain. Return only the
    // requested execution output, traceable source material and an execution
    // blocker when the Work Unit could not be completed. Root owns all judgment.
    return {
      delegationId:text(delegation?.id),
      result:text(raw?.result),
      evidence,
      blocker,
      ...(effectActuationClosure?{effectActuationClosure}:{}),
    };
  }
}
