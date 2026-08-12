import { SourceTraceVerifier } from '../governance/source-trace-verifier.js';
import { scopeTaskInputs } from './task-input-scope.js';

function text(value){return String(value==null?'':value).trim();}
function strings(values){return [...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];}

function normalizeDiscoveries(values=[]){
  return (Array.isArray(values)?values:[]).map(item=>({
    summary:text(item?.summary),
    whyRelevant:text(item?.whyRelevant),
    suggestedNextQuestion:text(item?.suggestedNextQuestion),
  })).filter(item=>item.summary&&item.whyRelevant&&item.suggestedNextQuestion);
}

export class SubagentRuntime {
  constructor({ executor, modelRouter, sourceTraceVerifier = new SourceTraceVerifier() }) {
    this.executor = executor;
    this.modelRouter = modelRouter;
    this.sourceTraceVerifier = sourceTraceVerifier;
  }

  async run(task, delegation, { onProgress = null, onExecutionStarted = null, signal = null, policyContext = null } = {}) {
    const scopedTask = scopeTaskInputs(task, delegation?.inputRefs);
    await this.modelRouter.prepare?.({ role:'subagent', task:scopedTask, work:delegation });
    const raw = await this.executor.runSubagent({
      task:scopedTask,
      delegation,
      validationFeedback:null,
      modelPolicy:this.modelRouter.route({ role:'subagent', task:scopedTask, work:delegation }),
      policyContext,
      onProgress,
      onExecutionStarted,
      signal,
    });

    const rawEvidence=Array.isArray(raw?.evidence)?raw.evidence:[];
    const traced=policyContext?.taskMode==='analysis'
      ? this.sourceTraceVerifier.enforce({task:scopedTask,evidence:rawEvidence,humanGatewayHistory:[]})
      : {evidence:rawEvidence};
    const evidence=Array.isArray(traced.evidence)?traced.evidence:[];
    const evidenceIds=new Set(evidence.map(item=>text(item?.id)).filter(Boolean));
    const findings=(Array.isArray(raw?.findings)?raw.findings:[]).map(item=>({
      id:text(item?.id),
      statement:text(item?.statement),
      evidenceIds:strings(item?.evidenceIds).filter(id=>evidenceIds.has(id)),
    })).filter(item=>item.id&&item.statement);

    // Runtime allow-list: a custom Executor cannot smuggle Task-level claims,
    // gaps, recommendations, Gateway controls, or a different Work Unit identity
    // through the Subagent result surface.
    return {
      delegationId:text(delegation?.id),
      result:text(raw?.result),
      evidence,
      findings,
      discoveries:normalizeDiscoveries(raw?.discoveries),
      blocker:text(raw?.blocker)||null,
      uncertainty:text(raw?.uncertainty)||null,
    };
  }
}
