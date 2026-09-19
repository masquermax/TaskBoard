function text(value){return String(value==null?'':value).trim();}
function list(value){return Array.isArray(value)?value:[];}

export const CERTIFIED_COGNITION_REUSE_CAPABILITY='certified-cognition-reuse';

// This capability deliberately projects only cognition that has already crossed
// the Root + Validator admission boundary. It is not a second memory store and
// it does not re-interpret Task truth. The returned objects are fresh values so
// child execution cannot mutate durable Certified State by aliasing it.
export function projectCertifiedKnownClaims(task={}){
  const analysis=task?.analysisState??task?.analysis_state??null;
  return list(analysis?.current?.claims)
    .filter(item=>item?.level==='confirmed'&&text(item?.id)&&text(item?.statement))
    .map(item=>({
      id:text(item.id),
      statement:text(item.statement),
      evidenceIds:list(item.evidenceIds).map(text).filter(Boolean),
      scope:text(item.scope)||null,
      coverage:text(item.coverage)||null,
      obligationRefs:list(item.obligationRefs).map(text).filter(Boolean),
    }));
}

export function rootRealityContinuityInstructions(){
  return [
    'Acquire Reality only to the precision needed for the next decision: if plausible values of an unknown would not change the next action, safety boundary, authority boundary, or completion judgment, do not create Work or Human Gateway merely to refine it.',
    'Preserve the precision of human-supplied information. An approximate statement may be sufficient for a low-stakes step; never silently upgrade it into a more exact fact. Revalidate only when the extra precision becomes decision-relevant.',
    'A supplied command result, log, screenshot-derived observation, or other Evidence may already contain facts beyond the one currently asked about. Reuse decision-relevant facts already present instead of reacquiring them, but do not inspect or persist irrelevant detail merely because it is visible.',
    'When a human-owned action is genuinely required, reduce human relay cost by bundling only observations that are safe/read-only, near-zero incremental effort in the same interaction, and likely to matter to the current path or a near next step. Do not turn this into a broad health check.',
    'Keep facts attached to their real subject when subject identity matters. Never borrow server B Reality for server A. But do not spend Work identifying or distinguishing subjects when that distinction cannot change the current interpretation or action.',
  ].join(' ');
}

export function certifiedCognitionReuseInstructions(){
  return [
    'knownClaims contains current CONFIRMED Task cognition already admitted by Root/Validator.',
    'Reuse knownClaims as the execution starting point; do not spend this Work merely rediscovering the same fact.',
    'Re-observation is valid only when this Work explicitly requires revalidation or fresh Reality gives a concrete reason the known Claim may no longer hold.',
    'If fresh direct Reality conflicts with a known Claim, return source-near Evidence plus a precise blocker/observation so Root can reopen or revise it; do not silently overwrite parent cognition.',
    'If the source/output you already had to observe for this Work also directly contains another decision-relevant or near-term reusable fact, you may return that extra source-near Evidence at zero extra probing cost. Do not expand the Work, run extra diagnostics, or inspect irrelevant details just to collect more facts.',
    'Preserve subject identity carried by the observed source. If fresh Reality is clearly from a different host/environment than the Work target and that difference changes interpretation or action, return the mismatch as Evidence/blocker instead of transferring the fact. If subject identity is irrelevant to the bounded result, do not investigate it.',
    'knownClaims are cognition, not authority: they never widen selected inputs, project/network access, or the Work Unit goal.',
  ].join(' ');
}
