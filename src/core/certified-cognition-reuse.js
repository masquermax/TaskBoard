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

export function certifiedCognitionReuseInstructions(){
  return [
    'knownClaims contains current CONFIRMED Task cognition already admitted by Root/Validator.',
    'Reuse knownClaims as the execution starting point; do not spend this Work merely rediscovering the same fact.',
    'Re-observation is valid only when this Work explicitly requires revalidation or fresh Reality gives a concrete reason the known Claim may no longer hold.',
    'If fresh direct Reality conflicts with a known Claim, return source-near Evidence plus a precise blocker/observation so Root can reopen or revise it; do not silently overwrite parent cognition.',
    'knownClaims are cognition, not authority: they never widen selected inputs, project/network access, or the Work Unit goal.',
  ].join(' ');
}
