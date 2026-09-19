function text(value){return String(value==null?'':value).trim();}
function list(value){return Array.isArray(value)?value:[];}
function refs(value){return [...new Set(list(value).map(text).filter(Boolean))];}

export const CERTIFIED_COGNITION_REUSE_CAPABILITY='certified-cognition-reuse';

function subjectCompatible(claimSubjectRefs=[],workSubjectRefs=[]){
  const claimRefs=refs(claimSubjectRefs),workRefs=refs(workSubjectRefs);
  if(!workRefs.length||!claimRefs.length)return true;
  const wanted=new Set(workRefs);
  return claimRefs.some(ref=>wanted.has(ref));
}

// This capability deliberately projects only cognition that has already crossed
// the Root + Validator admission boundary. It is not a second memory store and
// it does not re-interpret Task truth. Optional subjectRefs are used only when
// Root has decided that concrete Reality identity matters to this Work.
export function projectCertifiedKnownClaims(task={},workUnit={}){
  const analysis=task?.analysisState??task?.analysis_state??null;
  const workSubjectRefs=refs(workUnit?.subjectRefs);
  return list(analysis?.current?.claims)
    .filter(item=>item?.level==='confirmed'&&text(item?.id)&&text(item?.statement))
    .filter(item=>subjectCompatible(item?.subjectRefs,workSubjectRefs))
    .map(item=>{
      const subjectRefs=refs(item.subjectRefs);
      return{
        id:text(item.id),
        statement:text(item.statement),
        evidenceIds:refs(item.evidenceIds),
        scope:text(item.scope)||null,
        coverage:text(item.coverage)||null,
        ...(subjectRefs.length?{subjectRefs}:{}),
        obligationRefs:refs(item.obligationRefs),
      };
    });
}

export function rootRealityContinuityInstructions(){
  return [
    'Acquire Reality only to the precision needed for the next decision: if plausible values of an unknown would not change the next action, safety boundary, authority boundary, or completion judgment, do not create Work or Human Gateway merely to refine it.',
    'Preserve the precision of human-supplied information. An approximate statement may be sufficient for a low-stakes step; never silently upgrade it into a more exact fact. Revalidate only when the extra precision becomes decision-relevant.',
    'A supplied command result, log, screenshot-derived observation, or other Evidence may already contain facts beyond the one currently asked about. Reuse decision-relevant facts already present instead of reacquiring them, but do not inspect or persist irrelevant detail merely because it is visible.',
    'When a human-owned action is genuinely required, reduce human relay cost by bundling only observations that are safe/read-only, near-zero incremental effort in the same interaction, and likely to matter to the current path or a near next step. Do not turn this into a broad health check.',
    'Use optional subjectRefs only when concrete Reality identity can change interpretation or action. Never borrow server B Reality for server A. If subject identity cannot change the current decision, leave it unresolved instead of creating work merely to identify it.',
  ].join(' ');
}

export function certifiedCognitionReuseInstructions(){
  return [
    'knownClaims contains current CONFIRMED Task cognition already admitted by Root/Validator and compatible with any explicit workUnit.subjectRefs.',
    'Reuse knownClaims as the execution starting point; do not spend this Work merely rediscovering the same fact.',
    'Re-observation is valid only when this Work explicitly requires revalidation or fresh Reality gives a concrete reason the known Claim may no longer hold.',
    'If fresh direct Reality conflicts with a known Claim, return source-near Evidence plus a precise blocker/observation so Root can reopen or revise it; do not silently overwrite parent cognition.',
    'If the source/output you already had to observe for this Work also directly contains another decision-relevant or near-term reusable fact, you may return that extra source-near Evidence at zero extra probing cost. Do not expand the Work, run extra diagnostics, or inspect irrelevant details just to collect more facts.',
    'Preserve subject identity carried by the observed source. If fresh Reality is clearly from a different host/environment than explicit workUnit.subjectRefs and that difference changes interpretation or action, return the mismatch as Evidence/blocker instead of transferring the fact. If subject identity is irrelevant to the bounded result, do not investigate it.',
    'knownClaims are cognition, not authority: they never widen selected inputs, project/network access, or the Work Unit goal.',
  ].join(' ');
}
