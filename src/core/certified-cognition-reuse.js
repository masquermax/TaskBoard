function text(value){return String(value==null?'':value).trim();}
function list(value){return Array.isArray(value)?value:[];}
function refs(value){return [...new Set(list(value).map(text).filter(Boolean))];}
function stableRefs(value){return refs(value).sort();}

export const CERTIFIED_COGNITION_REUSE_CAPABILITY='certified-cognition-reuse';

function subjectCompatible(claimSubjectRefs=[],workSubjectRefs=[]){
  const claimRefs=refs(claimSubjectRefs),workRefs=refs(workSubjectRefs);
  if(!claimRefs.length)return true;
  if(!workRefs.length)return false;
  const wanted=new Set(workRefs);
  // Every concrete subject that the Claim depends on must be present in the Work
  // identity. Overlap alone is unsafe for relational cognition: an A+B Claim must
  // not become ambient A cognition merely because A is one of its subjects.
  return claimRefs.every(ref=>wanted.has(ref));
}

function projectionKey(item){
  return JSON.stringify([
    text(item?.statement),
    stableRefs(item?.subjectRefs),
    text(item?.scope)||null,
    text(item?.coverage)||null,
  ]);
}

function mergeProjectedClaim(target,item){
  target.evidenceIds=refs([...(target.evidenceIds||[]),...(item.evidenceIds||[])]);
  target.obligationRefs=refs([...(target.obligationRefs||[]),...(item.obligationRefs||[])]);
  return target;
}

// This capability deliberately projects only cognition that has already crossed
// the Root + Validator admission boundary. It is not a second memory store and
// it does not re-interpret Task truth.
//
// subjectRefs=[] on Work means the bounded execution has no concrete subject
// dependency. In that case only unbound/general cognition is injected; subject-
// bound facts stay out rather than becoming ambient context. Populated Work refs
// admit only Claims whose complete subject dependency is represented by the Work,
// plus unbound/general cognition.
//
// Projection also collapses exact semantic duplicates (same statement + subject
// + scope + coverage) so repeated Claim ids do not make later execution pay the
// same cognition cost multiple times.
export function projectCertifiedKnownClaims(task={},workUnit={}){
  const analysis=task?.analysisState??task?.analysis_state??null;
  const workSubjectRefs=refs(workUnit?.subjectRefs);
  const projected=[];
  const bySemanticKey=new Map();

  for(const item of list(analysis?.current?.claims)){
    if(item?.level!=='confirmed'||!text(item?.id)||!text(item?.statement))continue;
    if(!subjectCompatible(item?.subjectRefs,workSubjectRefs))continue;

    const subjectRefs=refs(item.subjectRefs);
    const candidate={
      id:text(item.id),
      statement:text(item.statement),
      evidenceIds:refs(item.evidenceIds),
      scope:text(item.scope)||null,
      coverage:text(item.coverage)||null,
      ...(subjectRefs.length?{subjectRefs}:{}),
      obligationRefs:refs(item.obligationRefs),
    };
    const key=projectionKey(candidate);
    const existing=bySemanticKey.get(key);
    if(existing){mergeProjectedClaim(existing,candidate);continue;}
    projected.push(candidate);
    bySemanticKey.set(key,candidate);
  }
  return projected;
}

export function rootRealityContinuityInstructions(){
  return [
    'Acquire Reality only to the precision needed for the next decision: if plausible values of an unknown would not change the next action, safety boundary, authority boundary, or completion judgment, do not create Work or Human Gateway merely to refine it.',
    'Preserve the precision of human-supplied information. An approximate statement may be sufficient for a low-stakes step; never silently upgrade it into a more exact fact. Revalidate only when the extra precision becomes decision-relevant.',
    'A supplied command result, log, screenshot-derived observation, or other Evidence may already contain facts beyond the one currently asked about. Reuse decision-relevant facts already present instead of reacquiring them, but do not inspect or persist irrelevant detail merely because it is visible.',
    'When a human-owned action is genuinely required, reduce human relay cost by bundling only observations that are safe/read-only, near-zero incremental effort in the same interaction, and likely to matter to the current path or a near next step. Do not turn this into a broad health check.',
    'Use subjectRefs only when concrete Reality identity can change interpretation or action. Never borrow server B Reality for server A. A Claim bound to multiple concrete subjects is reusable only in Work whose subjectRefs contain every subject that Claim depends on. Use subjectRefs=[] when identity cannot change the current decision; do not create work merely to identify it.',
    'When fresh DIRECT Evidence invalidates a current Claim about the same subject and fact slot, revise that existing Claim id with the new Evidence so current Certified State contains one active value. Do not add a second contradictory active Claim merely to preserve history; Certified State turn history already preserves the prior value.',
  ].join(' ');
}

export function certifiedCognitionReuseInstructions(){
  return [
    'knownClaims contains current CONFIRMED Task cognition already admitted by Root/Validator and compatible with explicit workUnit.subjectRefs when populated.',
    'When workUnit.subjectRefs is empty, only unbound/general cognition is injected; do not treat subject-bound facts from arbitrary systems as ambient context.',
    'A multi-subject known Claim is projected only when workUnit.subjectRefs contains all of that Claim\'s subjects; one matching subject is not enough to import relational cognition.',
    'Reuse knownClaims as the execution starting point; do not spend this Work merely rediscovering the same fact.',
    'Re-observation is valid only when this Work explicitly requires revalidation or fresh Reality gives a concrete reason the known Claim may no longer hold.',
    'If fresh direct Reality conflicts with a known Claim, return source-near Evidence plus a precise blocker/observation so Root can reopen or revise it; do not silently overwrite parent cognition.',
    'If the source/output you already had to observe for this Work also directly contains another decision-relevant or near-term reusable fact, you may return that extra source-near Evidence at zero extra probing cost. Do not expand the Work, run extra diagnostics, or inspect irrelevant details just to collect more facts.',
    'Preserve subject identity carried by the observed source. If fresh Reality is clearly from a different host/environment than populated workUnit.subjectRefs and that difference changes interpretation or action, return the mismatch as Evidence/blocker instead of transferring the fact. If subject identity is irrelevant to the bounded result, keep subjectRefs empty and do not investigate it.',
    'knownClaims are cognition, not authority: they never widen selected inputs, project/network access, or the Work Unit goal.',
  ].join(' ');
}
