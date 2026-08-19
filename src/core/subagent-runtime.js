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
    result:'当前 Work Unit 在技术执行边界内未能收敛成结构化结果；该执行边界已作为局部 Runtime 事实交回 Root。',
    evidence:[],
    findings:[],
    discoveries:[],
    blocker:'WORK_UNIT_NON_CONVERGENT: 当前 Work Unit 在技术执行边界内未满足停止条件；Root 应缩小或拆分工作边界，而不是原样重放。',
    uncertainty:'当前 expectedOutput 尚未在受限执行窗口内建立；没有新的 Task 级结论被认证。',
  };
}

function blockedDependency(delegation){
  return (Array.isArray(delegation?.dependencyResults)?delegation.dependencyResults:[]).find(item=>text(item?.result?.blocker));
}

function unmetDependencyResult(delegation,dependency){
  const dependencyId=text(dependency?.id)||'unknown';
  const reason=text(dependency?.result?.blocker)||'前置 Work Unit 未满足其工作契约。';
  return {
    delegationId:text(delegation?.id),
    result:`前置 Work Unit ${dependencyId} 未满足工作契约；当前依赖 Work Unit 未执行，控制权交回 Root 重新规划。`,
    evidence:[],
    findings:[],
    discoveries:[],
    blocker:`WORK_UNIT_DEPENDENCY_UNSATISFIED: 前置 Work Unit ${dependencyId} 未满足工作契约；不得在缺少其 expectedOutput 的情况下执行当前依赖 Work。`,
    uncertainty:`依赖 ${dependencyId} 的结果不可作为当前 Work Unit 的有效输入。原因：${reason}`,
  };
}

export class SubagentRuntime {
  constructor({ executor, modelRouter, sourceTraceVerifier = new SourceTraceVerifier() }) {
    this.executor = executor;
    this.modelRouter = modelRouter;
    this.sourceTraceVerifier = sourceTraceVerifier;
  }

  async run(task, delegation, { onProgress = null, onExecutionStarted = null, signal = null, policyContext = null } = {}) {
    // A declared dependency is part of this Work Unit's execution precondition.
    // If a prerequisite returned a blocker, do not spend another model/tool turn
    // pretending the expected dependency output exists. Return the local missing
    // dependency fact to Root; only Root may re-plan the affected dependency radius.
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
      // The technical lease is evidence about this execution, not a Task-level
      // reason to ask the human to replay the same read-only investigation.
      // Only side-effect-free Work can be safely converted into a local blocker;
      // effect-capable Work must retain the existing recovery/suspension path.
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

    const evidenceIds=new Set(evidence.map(item=>text(item?.id)).filter(Boolean));
    const findings=(Array.isArray(raw?.findings)?raw.findings:[]).map(item=>({
      id:text(item?.id),
      statement:text(item?.statement),
      evidenceIds:strings(item?.evidenceIds).filter(id=>evidenceIds.has(id)),
    })).filter(item=>item.id&&item.statement);
    const effectActuationClosure=normalizeEffectActuationClosure(raw?.effectActuationClosure,task,delegation,evidence);
    const blocker=text(raw?.blocker)||null;
    const uncertainty=text(raw?.uncertainty)||null;

    // The collector is transport/runtime telemetry only. Finalize it from the
    // SourceTraceVerifier-owned Evidence set so logging cannot invent Evidence.
    try {
      finalizeWorkUnitObservability({
        ...diagnosticIdentity,
        evidence,
        status:'completed',
        blocker,
        uncertainty,
      });
    } catch { /* diagnostics must never affect Work Unit semantics */ }

    // Runtime allow-list: Subagent owns only the current Work Unit execution.
    // Executor-provided next-work suggestions / out-of-scope discoveries are
    // intentionally discarded: Task-level planning and the decision to create
    // more Work belong only to Root. `discoveries: []` is retained temporarily
    // as a compatibility shape while executors stop producing that obsolete field.
    return {
      delegationId:text(delegation?.id),
      result:text(raw?.result),
      evidence,
      findings,
      discoveries:[],
      blocker,
      uncertainty,
      ...(effectActuationClosure?{effectActuationClosure}:{}),
    };
  }
}
