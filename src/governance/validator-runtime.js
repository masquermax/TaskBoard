import { ClaimLevel, normalizeAnalysisFields, GapKind, EvidenceSourceType } from './analysis-contract.js';
import { SourceTraceVerifier } from './source-trace-verifier.js';
import { hasCertifiedKnowledge, normalizeCertifiedState, normalizeGapResolutions } from './certified-state.js';
import { hasGovernedCandidateDelta } from './analysis-validator.js';

function text(value) { return String(value == null ? '' : value).trim(); }
function uniqueStrings(values) { return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))]; }
function compactViolation(v) { return { ruleId:v?.ruleId || null, target:v?.target || null, reason:text(v?.reason), action:v?.action || null }; }
function copyAnalysis(result = {}) {
  const fields = normalizeAnalysisFields(result);
  return {
    kind:result?.kind || null,
    summary:text(result?.summary),
    stageResult:result?.stageResult == null ? null : text(result.stageResult),
    finalResult:result?.finalResult == null ? null : text(result.finalResult),
    ...fields,
    gateway:result?.gateway || null,
    gapResolutions:normalizeGapResolutions(result?.gapResolutions),
    delegations:Array.isArray(result?.delegations) ? result.delegations : [],
  };
}
function itemKey(prefix, id, value) { return `${prefix}:${text(id)}:${text(value)}`; }

function mergeUniqueById(primary = [], supporting = []) {
  const out = [];
  const seen = new Set();
  for (const item of [...(Array.isArray(primary)?primary:[]), ...(Array.isArray(supporting)?supporting:[])]) {
    const id = text(item?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id); out.push(item);
  }
  return out;
}
function candidateIsEmpty(decision) {
  return !hasGovernedCandidateDelta(decision);
}
function stateSupportForCandidate(currentState, candidate) {
  const current=normalizeCertifiedState(currentState).current;
  return {
    evidence:current.evidence||[],
    claims:current.claims||[],
    gaps:current.gaps||[],
  };
}
function referencedEvidenceIds(candidate={}) {
  return new Set([
    ...(candidate?.claims||[]).flatMap(item=>item?.evidenceIds||[]),
    ...(candidate?.gaps||[]).flatMap(item=>item?.evidenceIds||[]),
    ...(candidate?.recommendations||[]).flatMap(item=>item?.evidenceIds||[]),
    ...normalizeGapResolutions(candidate?.gapResolutions).flatMap(item=>item?.evidenceIds||[]),
  ].map(text).filter(Boolean));
}
function selectedAvailableEvidence(candidate={}, availableEvidence=[]) {
  const wanted=referencedEvidenceIds(candidate);
  return (Array.isArray(availableEvidence)?availableEvidence:[]).filter(item=>wanted.has(text(item?.id)));
}
function extractCandidateAfterValidation(validated, originalCandidate, support) {
  const candidateEvidenceIds=new Set((originalCandidate?.evidence||[]).map(item=>text(item?.id)).filter(Boolean));
  const candidateClaimIds=new Set((originalCandidate?.claims||[]).map(item=>text(item?.id)).filter(Boolean));
  const candidateGapIds=new Set((originalCandidate?.gaps||[]).map(item=>text(item?.id)).filter(Boolean));
  const candidateRecIds=new Set((originalCandidate?.recommendations||[]).map(item=>text(item?.id)).filter(Boolean));
  const candidateStepOrders=new Set((originalCandidate?.steps||[]).map(item=>Number(item?.order)).filter(Number.isInteger));
  const supportGapIds=new Set((support?.gaps||[]).map(item=>text(item?.id)).filter(Boolean));
  return {
    ...validated,
    evidence:(validated.evidence||[]).filter(item=>candidateEvidenceIds.has(text(item?.id))),
    claims:(validated.claims||[]).filter(item=>candidateClaimIds.has(text(item?.id))),
    gaps:(validated.gaps||[]).filter(item=>candidateGapIds.has(text(item?.id)) || !supportGapIds.has(text(item?.id))),
    recommendations:(validated.recommendations||[]).filter(item=>candidateRecIds.has(text(item?.id))),
    steps:(validated.steps||[]).filter(item=>candidateStepOrders.has(Number(item?.order))),
    gapResolutions:normalizeGapResolutions(originalCandidate?.gapResolutions),
  };
}

/**
 * Validator is a system authority, not a single resident model Agent.
 * These methods are intentionally stateless and synchronous so independent
 * Tasks/Subagents can be certified concurrently without a central queue.
 */
export class ValidatorRuntime {
  constructor({ analysisValidator = null, sourceTraceVerifier = new SourceTraceVerifier(), semanticVerifier = null } = {}) {
    this.analysisValidator = analysisValidator;
    this.sourceTraceVerifier = sourceTraceVerifier;
    this.semanticVerifier = semanticVerifier;
  }

  reviewRoot({ decision, policyContext = null, attempt = 1, seenKnowledgeKeys = new Set(), task = null, humanGatewayHistory = [], currentState = null, availableEvidence = [] } = {}) {
    // Certification ownership is selected by the Candidate content boundary, not
    // taskMode/resultMode. Pure control/presentation decisions carry no Certified
    // State delta, but any governed Candidate Delta requires the structural owner.
    if (!this.analysisValidator) {
      if (!hasGovernedCandidateDelta(decision)) {
        return { outcome:'pass', decision, feedback:[], actions:[], commits:[], observedKnowledgeKeys:[] };
      }
      const feedback=[{ruleId:'C-003',target:'validator',reason:'Governed Candidate Delta requires Validator structural certification.',action:'REQUIRE_VALIDATOR'}];
      return { outcome:'reject', decision, feedback, actions:[], commits:[], observedKnowledgeKeys:[] };
    }
    const proposed=copyAnalysis(decision);
    proposed.gapResolutions=normalizeGapResolutions(decision?.gapResolutions);
    // Evidence ownership is enforced independently of the model schema. Root may
    // create Human/Reference evidence from its Task context, but Project/Attachment
    // evidence must arrive through a completed Subagent result. A custom Executor
    // cannot widen Root authority by returning a different sourceType.
    const rootOwnedSourceTypes=new Set([EvidenceSourceType.HUMAN,EvidenceSourceType.REFERENCE]);
    const rootEvidence=(Array.isArray(proposed.evidence)?proposed.evidence:[]).filter(item=>rootOwnedSourceTypes.has(item?.sourceType));
    const droppedRootEvidence=(Array.isArray(proposed.evidence)?proposed.evidence:[]).filter(item=>!rootOwnedSourceTypes.has(item?.sourceType));
    proposed.evidence=mergeUniqueById(selectedAvailableEvidence(proposed,availableEvidence),rootEvidence);
    const traced=this.sourceTraceVerifier.enforce({task,evidence:proposed.evidence,humanGatewayHistory});
    proposed.evidence=traced.evidence;
    const preActions=[
      ...droppedRootEvidence.map(item=>({action:'DROP_UNOWNED_ROOT_EVIDENCE',target:text(item?.id),reason:`Root does not own ${text(item?.sourceType)||'unknown'} evidence collection.`})),
      ...traced.actions,
    ];
    const support=stateSupportForCandidate(currentState,proposed);
    const validationInput={
      ...proposed,
      evidence:mergeUniqueById(proposed.evidence,support.evidence),
      claims:mergeUniqueById(proposed.claims,support.claims),
      gaps:mergeUniqueById(proposed.gaps,support.gaps),
      // An empty completion delta is valid when the Task already has committed
      // knowledge. Completion is checked against the merged state by RootRuntime.
      kind:proposed.kind==='complete' && candidateIsEmpty(proposed) && hasCertifiedKnowledge(currentState) ? 'delegate' : proposed.kind,
    };
    const checkedRaw = this.analysisValidator.validateAndRepair(validationInput, policyContext);
    const checked = { ...checkedRaw, decision:extractCandidateAfterValidation({...checkedRaw.decision,kind:proposed.kind},proposed,support) };
    if (!checked.valid) {
      const feedback = checked.violations.map(compactViolation);
      if (attempt < 2) return { outcome:'rework', decision:checked.decision, feedback, actions:[...preActions,...checked.actions], commits:[], observedKnowledgeKeys:[], sourceVerifications:traced.verifications };
      const safe = this.makeSafeRootResult(checked.decision, feedback);
      const safeSupport=stateSupportForCandidate(currentState,safe);
      const recheckedRaw=this.analysisValidator.validateAndRepair({...safe,evidence:mergeUniqueById(safe.evidence,safeSupport.evidence),claims:mergeUniqueById(safe.claims,safeSupport.claims),gaps:mergeUniqueById(safe.gaps,safeSupport.gaps),kind:safe.kind==='complete'&&candidateIsEmpty(safe)&&hasCertifiedKnowledge(currentState)?'delegate':safe.kind},policyContext);
      const rechecked={...recheckedRaw,decision:extractCandidateAfterValidation({...recheckedRaw.decision,kind:safe.kind},safe,safeSupport)};
      if (!rechecked.valid) {
        // Validator may certify/narrow content, but it does not own Root's control
        // decision. If the remaining violation is only that Root attempted to
        // complete while a certified blocking Gap exists, hand the certified
        // content back to Root to choose the next action.
        const controlOnly = rechecked.violations.length > 0 && rechecked.violations.every(v=>v?.target==='blocking-gap');
        if (controlOnly) {
          const progress = this.deriveNewRootProgress(rechecked.decision, seenKnowledgeKeys);
          return { outcome:'pass', decision:rechecked.decision, feedback:[...feedback,...rechecked.violations.map(compactViolation)], actions:[...preActions,...checked.actions,...rechecked.actions,{action:'HANDOFF_ROOT_CONTROL_DECISION',target:'blocking-gap'}], sourceVerifications:traced.verifications, requiresRootDecision:true, ...progress };
        }
        return { outcome:'reject', decision:rechecked.decision, feedback:rechecked.violations.map(compactViolation), actions:[...preActions,...checked.actions,...rechecked.actions], commits:[], observedKnowledgeKeys:[], sourceVerifications:traced.verifications };
      }
      const progress = this.deriveNewRootProgress(rechecked.decision, seenKnowledgeKeys);
      return { outcome:'pass', decision:rechecked.decision, feedback, actions:[...preActions,...checked.actions,{action:'CONVERT_ROOT_FAILURE_TO_GAP',target:'validator-root-gap'}], sourceVerifications:traced.verifications, ...progress };
    }
    const progress = this.deriveNewRootProgress(checked.decision, seenKnowledgeKeys);
    return { outcome:'pass', decision:checked.decision, feedback:[], actions:[...preActions,...checked.actions], sourceVerifications:traced.verifications, ...progress };
  }

  semanticFeedback(reviews = []) {
    return (Array.isArray(reviews) ? reviews : [])
      .filter(item => item?.verdict !== 'supported')
      .map(item => {
        const type=item?.candidateType==='gap_resolution'?'gap_resolution':'claim';
        const targetId=text(item?.targetId)||text(item?.id).replace(/^gap_resolution:/,'');
        return {
          principleId:'C-003', principleIds:['C-003'], ruleId:'C-003',
          target:type==='gap_resolution'?`gap:${targetId}`:`claim:${targetId}`,
          reason:type==='gap_resolution'
            ? `Human Gateway 回答不足以证明该 Gap 已被解决：${text(item?.reason) || '回答没有明确给出该问题所需的决定或事实。'}`
            : `可追溯原始证据不足以认证该语义结论：${text(item?.reason) || '存在未经证明的语义跳跃。'}`,
          action:'SEMANTIC_DOWNGRADE', repairable:false,
        };
      });
  }

  applySemanticFailures(decision, reviews = []) {
    const failedReviews=(Array.isArray(reviews)?reviews:[]).filter(item=>item?.verdict!=='supported');
    if(!failedReviews.length)return copyAnalysis(decision);
    const failedClaims=new Map(failedReviews.filter(item=>item?.candidateType!=='gap_resolution').map(item=>[text(item?.targetId)||text(item?.id),item]));
    const failedGapResolutions=new Set(failedReviews.filter(item=>item?.candidateType==='gap_resolution').map(item=>text(item?.targetId)||text(item?.id).replace(/^gap_resolution:/,'')).filter(Boolean));
    const d=copyAnalysis(decision);const existing=new Set(d.gaps.map(g=>text(g?.id)));
    d.gapResolutions=normalizeGapResolutions(decision?.gapResolutions).filter(item=>!failedGapResolutions.has(text(item?.gapId)));
    for(const claim of d.claims){
      const review=failedClaims.get(text(claim?.id));
      if(!review||claim?.level!==ClaimLevel.CONFIRMED)continue;
      claim.level=ClaimLevel.SUPPORTED;
      let base=`VALIDATOR-SEM-GAP-${text(claim.id)||'claim'}`.replace(/[^A-Za-z0-9_-]/g,'-');let id=base,n=2;
      while(existing.has(id)){id=`${base}-${n++}`;}existing.add(id);
      d.gaps.push({
        id,
        question:`待确认：${text(claim.statement)}`,
        reason:`可追溯原始证据不足以证明该完整结论。${text(review?.reason)?` ${text(review.reason)}`:''}`,
        kind:GapKind.MISSING_FACT,
        blocking:false,
        evidenceIds:uniqueStrings(claim.evidenceIds),
      });
    }
    return d;
  }

  async semanticReviewRoot({ reviewed, policyContext = null, attempt = 1, seenKnowledgeKeys = new Set(), task = null, humanGatewayHistory = [], currentState = null, onProgress = null, onExecutionStarted = null, signal = null } = {}) {
    if(!this.semanticVerifier||reviewed?.outcome!=='pass')return reviewed;
    // SemanticProofVerifier owns candidate selection. Mode labels never decide
    // whether a structurally certified Candidate is eligible for semantic proof.
    const semantic=await this.semanticVerifier.review({task,decision:reviewed.decision,policyContext,sourceVerifications:reviewed.sourceVerifications,humanGatewayHistory,currentState,onProgress,onExecutionStarted,signal});
    const feedback=this.semanticFeedback(semantic.reviews);
    if(!feedback.length)return{...reviewed,actions:[...(reviewed.actions||[]),...(semantic.actions||[])]};

    // Validator certifies the evidence boundary; it does not send Root back to
    // rethink the same Task merely because a claimed fact exceeds that boundary.
    // Narrow the claim immediately (CONFIRMED -> SUPPORTED + explicit Gap), keep
    // failed Gap resolutions open, then let Root continue only if the resulting
    // certified state genuinely requires a different control action.
    const safe=this.applySemanticFailures(reviewed.decision,semantic.reviews);
    const support=stateSupportForCandidate(currentState,safe);
    const checkedRaw=this.analysisValidator.validateAndRepair({...safe,evidence:mergeUniqueById(safe.evidence,support.evidence),claims:mergeUniqueById(safe.claims,support.claims),gaps:mergeUniqueById(safe.gaps,support.gaps),kind:safe.kind==='complete'&&candidateIsEmpty(safe)&&hasCertifiedKnowledge(currentState)?'delegate':safe.kind},policyContext);
    const checked={...checkedRaw,decision:extractCandidateAfterValidation({...checkedRaw.decision,kind:safe.kind},safe,support)};
    if(!checked.valid){
      const controlOnly=checked.violations.length>0&&checked.violations.every(v=>v?.target==='blocking-gap');
      if(controlOnly){
        const progress=this.deriveNewRootProgress(checked.decision,seenKnowledgeKeys);
        return{outcome:'pass',decision:checked.decision,feedback:[...feedback,...checked.violations.map(compactViolation)],actions:[...(reviewed.actions||[]),...(semantic.actions||[]),...checked.actions,{action:'HANDOFF_ROOT_CONTROL_DECISION',target:'blocking-gap'}],requiresRootDecision:true,...progress};
      }
      return{outcome:'reject',decision:checked.decision,feedback:[...feedback,...checked.violations.map(compactViolation)],actions:[...(reviewed.actions||[]),...(semantic.actions||[]),...checked.actions],commits:[],observedKnowledgeKeys:[]};
    }
    const progress=this.deriveNewRootProgress(checked.decision,seenKnowledgeKeys);
    return{outcome:'pass',decision:checked.decision,feedback,actions:[...(reviewed.actions||[]),...(semantic.actions||[]),...checked.actions,{action:'CONVERT_SEMANTIC_FAILURE_TO_GAP',target:'root'}],...progress};
  }

  makeSafeRootResult(decision, feedback = []) {
    const d = copyAnalysis(decision);
    const gapId = 'VALIDATOR-ROOT-GAP';
    if (!d.gaps.some(g => text(g?.id) === gapId)) {
      const claimsById = new Map((d.claims || []).map(claim => [text(claim?.id), claim]).filter(([id]) => id));
      const unresolvedStatements = uniqueStrings((feedback || []).map(item => {
        const target = text(item?.target).replace(/^claim:/,'');
        return text(claimsById.get(target)?.statement);
      }));
      d.gaps.push({
        id:gapId,
        question:unresolvedStatements.length ? `待确认：${unresolvedStatements.join('；')}` : '待确认：当前仍有结论缺少足够可追溯证据。',
        reason:`经过一次针对性修正后，现有证据仍不足以把该部分作为已确认事实发布。${feedback.length ? ` 主要缺口：${feedback.slice(0,4).map(v=>v.reason).join('；')}` : ''}`,
        kind:GapKind.MISSING_FACT,
        blocking:false,
        evidenceIds:[],
      });
    }
    d.stageResult=null;
    d.finalResult=null;
    // Keep Root's control decision untouched. Validator certifies content; if the
    // control decision conflicts with the narrowed content, reviewRoot returns an
    // explicit Handoff so Root can decide the next action.
    return d;
  }

  deriveNewRootProgress(decision, seenKnowledgeKeys = new Set()) {
    const d = copyAnalysis(decision);
    const unseenClaims = [];
    const unseenGaps = [];
    const resolutions = normalizeGapResolutions(d.gapResolutions);

    for (const claim of d.claims) {
      if (claim?.level !== ClaimLevel.CONFIRMED || !text(claim?.id) || !text(claim?.statement)) continue;
      const key = itemKey('claim', claim.id, claim.statement);
      if (!seenKnowledgeKeys.has(key)) unseenClaims.push({ item:claim, key });
    }
    for (const gap of d.gaps) {
      if (!text(gap?.id) || !text(gap?.question)) continue;
      const key = itemKey('gap', gap.id, `${gap.question}|${gap.reason || ''}`);
      if (!seenKnowledgeKeys.has(key)) unseenGaps.push({ item:gap, key });
    }

    // Validator owns the semantic-value decision for History. Task Core may later
    // reject an invalid state transition, but no downstream component may derive a
    // different History sentence from the same Candidate/Turn.
    if (!unseenClaims.length && !unseenGaps.length && !resolutions.length) {
      if (decision && typeof decision==='object') delete decision.__historyCommit;
      return { commits:[], observedKnowledgeKeys:[] };
    }

    const claimTexts = unseenClaims.map(({item})=>text(item.statement)).filter(Boolean);
    const gapTexts = unseenGaps.map(({item})=>text(item.question).replace(/^待确认[：:]\s*/,'')).filter(Boolean);
    const resolvedTexts = resolutions.map(item=>text(item.reason)).filter(Boolean);
    const detailParts = [];
    if (claimTexts.length) detailParts.push(claimTexts.join('；'));
    if (gapTexts.length) detailParts.push(`待确认：${gapTexts.join('；')}`);
    if (resolvedTexts.length) detailParts.push(`已闭合：${resolvedTexts.join('；')}`);
    const title = claimTexts.length && gapTexts.length
      ? '阶段结论已收敛'
      : claimTexts.length
        ? '阶段事实已确认'
        : resolvedTexts.length && !gapTexts.length
          ? '待确认边界已闭合'
          : '待确认边界已收敛';
    const sourceIds = [
      ...unseenClaims.map(({item})=>text(item.id)),
      ...unseenGaps.map(({item})=>text(item.id)),
      ...resolutions.map(item=>text(item.gapId)),
    ].filter(Boolean);
    const observedKnowledgeKeys = [
      ...unseenClaims.map(({key})=>key),
      ...unseenGaps.map(({key})=>key),
    ];
    const commit={ title, detail:detailParts.join('；'), sourceIds };
    if (decision && typeof decision==='object') decision.__historyCommit={...commit,sourceIds:[...sourceIds]};
    return { commits:[commit], observedKnowledgeKeys };
  }
}
