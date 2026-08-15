import {
  EvidenceStrength,
  EvidenceKind,
  EvidenceSourceType,
  EvidenceCoverage,
  ClaimLevel,
  ClaimScope,
  GapKind,
  normalizeAnalysisFields,
} from './analysis-contract.js';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function text(value) { return String(value == null ? '' : value).trim(); }
function uniqueStrings(values) { return [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))]; }
function uniqueById(items) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const id = text(item?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(item);
  }
  return out;
}
function idMap(items) { return new Map((items || []).map(item => [text(item?.id), item]).filter(([id]) => id)); }
function violation(ruleId, target, reason, action, repairable = true) {
  const principleIds = String(ruleId||'').startsWith('C-') ? [ruleId] : [];
  return { principleId:principleIds[0]||null, principleIds, ruleId, target, reason, action, repairable };
}
function principleViolation(principleIds, target, reason, action, repairable = true) { const ids=Array.isArray(principleIds)?principleIds:[principleIds]; return { principleId:ids[0]||null, principleIds:ids, ruleId:ids[0]||'CONSTITUTION', target, reason, action, repairable }; }
export function pendingAnalysisItems(decision) {
  const gaps=Array.isArray(decision?.gaps)?decision.gaps:[];
  const supported=(decision?.claims||[]).filter(c=>c?.level===ClaimLevel.SUPPORTED).filter(claim=>{
    const statement=text(claim?.statement);
    return statement&&!gaps.some(gap=>text(gap?.question).includes(statement));
  });
  return [
    ...supported.map(claim=>({kind:'claim',id:text(claim.id),text:text(claim.statement)})),
    ...gaps.map(gap=>({kind:'gap',id:text(gap.id),text:text(gap.question)})),
  ];
}

export function hasGovernedCandidateDelta(decision = {}) {
  const normalized=normalizeAnalysisFields(decision);
  return ['evidence','claims','gaps','recommendations','steps']
    .some(key=>Array.isArray(normalized[key])&&normalized[key].length>0)
    || (Array.isArray(decision?.gapResolutions)&&decision.gapResolutions.length>0);
}

export function canonicalAnalysisSummary(decision) {
  const confirmed=(decision?.claims||[]).filter(c=>c?.level===ClaimLevel.CONFIRMED).length;
  const pending=pendingAnalysisItems(decision).length;
  const recommendations=(decision?.recommendations||[]).length;
  const parts=[`${confirmed} 项已确认`];
  if(pending)parts.push(`${pending} 项待确认`);
  if(recommendations)parts.push(`${recommendations} 项建议`);
  return `分析已完成：${parts.join('，')}。`;
}
const COVERAGE_RANK = Object.freeze({ source:0, component:1, project:2, system:3, cross_system:4 });
function hasCoverage(value){return Object.values(EvidenceCoverage).includes(value);}
function coverageSupports(evidence, claim){if(!hasCoverage(claim?.coverage))return true;const direct=(evidence||[]).filter(e=>e?.strength===EvidenceStrength.DIRECT&&hasCoverage(e?.coverage));if(!direct.length)return true;return direct.some(e=>COVERAGE_RANK[e.coverage]>=COVERAGE_RANK[claim.coverage]);}
function directEvidenceIds(ids, evidenceById) {
  return uniqueStrings(ids).filter(id => evidenceById.get(id)?.strength === EvidenceStrength.DIRECT);
}
function isRequirementTruthClaim(claim, evidenceById) {
  const direct=directEvidenceIds(claim?.evidenceIds,evidenceById).map(id=>evidenceById.get(id)).filter(Boolean);
  return direct.length>0 && direct.every(evidence=>evidence?.kind===EvidenceKind.REQUIREMENT);
}
function gapId(prefix, existing) {
  let i = 1;
  while (existing.has(`${prefix}-${i}`)) i += 1;
  const id = `${prefix}-${i}`;
  existing.add(id);
  return id;
}

function candidateResolvedGapIds(decision, evidenceById) {
  const resolved = new Set();
  for (const item of Array.isArray(decision?.gapResolutions) ? decision.gapResolutions : []) {
    const gapId = text(item?.gapId);
    const refs = uniqueStrings(item?.evidenceIds);
    if (!gapId || !text(item?.reason) || refs.length === 0) continue;
    if (refs.every(id => evidenceById.has(id))) resolved.add(gapId);
  }
  return resolved;
}

function analysisViewAfterCandidateResolutions(decision, evidenceById) {
  const resolved = candidateResolvedGapIds(decision, evidenceById);
  if (!resolved.size) return decision;
  return {
    ...decision,
    gaps:(Array.isArray(decision?.gaps) ? decision.gaps : []).filter(gap => !resolved.has(text(gap?.id))),
  };
}

export class AnalysisResultValidator {
  validate(decision, _policyContext = null) {
    const normalized = { ...decision, ...normalizeAnalysisFields(decision) };
    const violations = [];
    // C-003 is a Candidate-content boundary, not a task/result mode boundary.
    // Any Candidate that carries governed knowledge must preserve strict source
    // anchors. resultMode remains presentation-only below.
    const strictBoundaries = true;

    const evidenceIds = new Set();
    for (const evidence of normalized.evidence) {
      const id = text(evidence?.id);
      if (!id) violations.push(violation('C-003','evidence','Evidence id is empty.','DROP_EVIDENCE'));
      else if (evidenceIds.has(id)) violations.push(violation('C-003',id,'Evidence id is duplicated.','DEDUPLICATE'));
      else evidenceIds.add(id);
      if (!text(evidence?.basis) || !text(evidence?.statement)) violations.push(violation('C-003',id || 'evidence','Evidence must have both statement and concrete basis.','DROP_EVIDENCE'));
      if (strictBoundaries && (!text(evidence?.locator) || !text(evidence?.observation))) violations.push(violation('C-003',id || 'evidence','Evidence must preserve a concrete Source Anchor locator and source-near observation.','MODEL_REPAIR',false));
      if (evidence?.strength===EvidenceStrength.DIRECT && text(evidence?.observation) && text(evidence?.statement)!==text(evidence?.observation)) violations.push(violation('C-003',id || 'evidence','DIRECT Evidence statement must stay source-near and equal its Source Anchor observation; business interpretation belongs in Claim.','CANONICALIZE_EVIDENCE'));
      if (!Object.values(EvidenceStrength).includes(evidence?.strength) || !Object.values(EvidenceKind).includes(evidence?.kind)) violations.push(violation('C-003',id || 'evidence','Evidence strength/kind is invalid.','DROP_EVIDENCE'));
      if ((strictBoundaries && !Object.values(EvidenceSourceType).includes(evidence?.sourceType)) || (evidence?.sourceType != null && !Object.values(EvidenceSourceType).includes(evidence.sourceType))) violations.push(violation('C-003',id || 'evidence','Evidence sourceType is missing or invalid; C-003 requires an explicit source boundary.','DROP_EVIDENCE'));
      if ((strictBoundaries && !hasCoverage(evidence?.coverage)) || (evidence?.coverage != null && !hasCoverage(evidence.coverage))) violations.push(violation('C-003',id || 'evidence','Evidence coverage is missing or invalid; C-003 requires an explicit coverage boundary.','DROP_EVIDENCE'));
    }
    const evidenceById = idMap(normalized.evidence);

    const claimIds = new Set();
    for (const claim of normalized.claims) {
      const id = text(claim?.id);
      if (!id) violations.push(violation('C-003','claim','Claim id is empty.','DROP_CLAIM'));
      else if (claimIds.has(id)) violations.push(violation('C-003',id,'Claim id is duplicated.','DEDUPLICATE'));
      else claimIds.add(id);
      if (!text(claim?.statement)) violations.push(violation('C-003',id || 'claim','Claim statement is empty.','DROP_CLAIM'));
      if (!Object.values(ClaimLevel).includes(claim?.level) || !Object.values(ClaimScope).includes(claim?.scope)) violations.push(violation('C-003',id || 'claim','Claim level/scope is invalid.','DROP_CLAIM'));
      if ((strictBoundaries && !hasCoverage(claim?.coverage)) || (claim?.coverage != null && !hasCoverage(claim.coverage))) violations.push(violation('C-003',id || 'claim','Claim coverage is missing or invalid.','DROP_CLAIM'));
      const rawRefs = uniqueStrings(claim?.evidenceIds);
      const refs = rawRefs.filter(ref => evidenceById.has(ref));
      const requirementTruth=isRequirementTruthClaim({...claim,evidenceIds:refs},evidenceById);
      if (rawRefs.some(ref => !evidenceById.has(ref))) violations.push(violation('C-003',id || 'claim','Claim references unknown Evidence ids.','DROP_UNKNOWN_REFS'));
      if (refs.length === 0) violations.push(violation('C-003',id || 'claim','Claim has no valid supporting Evidence. Missing knowledge must remain a Gap.','CLAIM_TO_GAP'));
      if (claim?.level === ClaimLevel.CONFIRMED && directEvidenceIds(refs,evidenceById).length === 0) {
        violations.push(violation('C-003',id || 'claim','CONFIRMED claim has no DIRECT evidence.','DOWNGRADE_TO_GAP'));
      }
      if (claim?.level === ClaimLevel.CONFIRMED && hasCoverage(claim?.coverage)) {
        const supporting = refs.map(ref=>evidenceById.get(ref)).filter(Boolean);
        if (!coverageSupports(supporting,claim)) violations.push(violation('C-003',id || 'claim',`Claim coverage ${claim.coverage} is broader than its DIRECT Evidence coverage.`,'DOWNGRADE_TO_GAP'));
      }
      if (claim?.scope === ClaimScope.CROSS_SYSTEM && hasCoverage(claim?.coverage) && claim.coverage !== EvidenceCoverage.CROSS_SYSTEM) violations.push(violation('C-003',id || 'claim','Cross-system Claim must declare cross_system coverage.','DOWNGRADE_TO_GAP'));
      // A requirement source may directly state a cross-system requirement. That
      // proves "the requirement says X"; it does not prove the implementation has
      // each runtime hop. Per-hop proof is therefore an implementation-truth rule.
      if (claim?.scope === ClaimScope.CROSS_SYSTEM && !requirementTruth) {
        if (!Array.isArray(claim?.hops) || claim.hops.length === 0) {
          violations.push(violation('C-003',id || 'claim','Cross-system claim has no explicit hops.','CLAIM_TO_GAP'));
        } else {
          for (const hop of claim.hops) {
            const rawHopRefs = uniqueStrings(hop?.evidenceIds);
            const hopRefs = rawHopRefs.filter(ref => evidenceById.has(ref));
            if (rawHopRefs.some(ref => !evidenceById.has(ref))) violations.push(violation('C-003',id || 'claim',`Cross-system hop ${text(hop?.from)||'?'} -> ${text(hop?.to)||'?'} references unknown Evidence ids.`,'DROP_UNKNOWN_REFS'));
            if (!text(hop?.from) || !text(hop?.to) || hopRefs.length === 0) {
              violations.push(violation('C-003',id || 'claim',`Cross-system hop ${text(hop?.from)||'?'} -> ${text(hop?.to)||'?'} has no valid hop Evidence.`,'CLAIM_TO_GAP'));
              break;
            }
            if (claim?.level === ClaimLevel.CONFIRMED && directEvidenceIds(hopRefs,evidenceById).length === 0) {
              violations.push(violation('C-003',id || 'claim',`Cross-system hop ${text(hop?.from)||'?'} -> ${text(hop?.to)||'?'} lacks DIRECT evidence.`,'DOWNGRADE_TO_GAP'));
              break;
            }
          }
        }
      }
    }

    const gapIdsSeen = new Set();
    for (const gap of normalized.gaps) {
      const id = text(gap?.id);
      if (!id || gapIdsSeen.has(id)) violations.push(violation('C-003',id || 'gap','Gap id is empty or duplicated.','DROP_OR_DEDUPLICATE_GAP'));
      else gapIdsSeen.add(id);
      if (!text(gap?.question) || !text(gap?.reason) || !Object.values(GapKind).includes(gap?.kind) || typeof gap?.blocking !== 'boolean') violations.push(violation('C-003',id || 'gap','Gap must contain a valid question, reason, kind and blocking flag.','DROP_GAP'));
      const refs = uniqueStrings(gap?.evidenceIds);
      if (refs.some(ref => !evidenceById.has(ref))) violations.push(violation('C-003',id || 'gap','Gap references unknown Evidence ids.','DROP_UNKNOWN_REFS'));
    }
    const gapsById = idMap(normalized.gaps);
    const completionView = analysisViewAfterCandidateResolutions(normalized,evidenceById);
    if (normalized.kind === 'complete' && completionView.gaps.some(gap => gap?.blocking === true)) {
      violations.push(violation('C-004','blocking-gap','A complete result contains a blocking Gap that is not resolved by this candidate. Root must resolve it with traceable Evidence, mark it non-blocking with justification, or return Human Gateway.','MODEL_REPAIR',false));
    }

    const recIds = new Set();
    for (const rec of normalized.recommendations) {
      const id = text(rec?.id);
      if (!id) violations.push(violation('C-003','recommendation','Recommendation id is empty.','DROP_RECOMMENDATION'));
      else if (recIds.has(id)) violations.push(violation('C-003',id,'Recommendation id is duplicated.','DEDUPLICATE'));
      else recIds.add(id);
      if (!text(rec?.statement) || !text(rec?.rationale)) violations.push(violation('C-003',id || 'recommendation','Recommendation must contain statement and rationale.','DROP_RECOMMENDATION'));
      const rawEvidenceRefs = uniqueStrings(rec?.evidenceIds);
      const rawGapRefs = uniqueStrings(rec?.gapIds);
      const evidenceRefs = rawEvidenceRefs.filter(ref => evidenceById.has(ref));
      const gapRefs = rawGapRefs.filter(ref => gapsById.has(ref));
      if (rawEvidenceRefs.some(ref => !evidenceById.has(ref)) || rawGapRefs.some(ref => !gapsById.has(ref))) {
        violations.push(violation('C-003',id || 'recommendation','Recommendation references unknown Evidence/Gap ids.','DROP_UNKNOWN_REFS'));
      }
      if (evidenceRefs.length === 0 && gapRefs.length === 0) {
        violations.push(violation('C-003',id || 'recommendation','Recommendation has no traceable Evidence or Gap context.','DROP_RECOMMENDATION'));
      }
    }

    const confirmedById = new Map(normalized.claims.filter(c => c.level === ClaimLevel.CONFIRMED).map(c => [text(c.id), c]).filter(([id]) => id));
    const stepOrders = new Set();
    const stepSources = new Set();
    for (const step of normalized.steps) {
      const refs = uniqueStrings(step?.sourceIds);
      const orderValid = Number.isInteger(step?.order) && !stepOrders.has(step.order);
      if (Number.isInteger(step?.order)) stepOrders.add(step.order);
      const sources = refs.map(id=>confirmedById.get(id)).filter(Boolean);
      const refsValid = refs.length > 0 && sources.length === refs.length;
      const sourcesUnique = refs.every(id=>!stepSources.has(id));
      refs.forEach(id=>stepSources.add(id));
      const canonical = sources.map(source=>text(source.statement)).join('；');
      if (!orderValid || !refsValid || !sourcesUnique || step?.kind !== 'confirmed' || !text(step?.text)) {
        violations.push(violation('C-003',`step:${step?.order ?? '?'}`,'Main analysis steps may use one or more CONFIRMED Claims; recommendations remain in 【建议】 and the same Claim is not duplicated across steps.','DROP_STEP'));
      } else if (text(step.text) !== canonical) {
        violations.push(violation('C-003',`step:${step?.order ?? '?'}`,'Step text adds wording beyond its cited CONFIRMED Claims; canonicalize it from those Claims.','CANONICALIZE_STEP'));
      }
    }

    // resultMode may shape the final analysis serialization, but never whether the
    // Candidate receives structural certification.
    if(normalized.resultMode==='analysis'&&normalized.kind==='complete'){
      const expectedSummary=canonicalAnalysisSummary(analysisViewAfterCandidateResolutions(normalized,evidenceById));
      if(text(normalized.summary)!==expectedSummary) violations.push(principleViolation('C-003','summary','User-visible analysis completion summary must be derived from the validated structured result, not free Root wording.','CANONICALIZE_SUMMARY'));
    }

    if (normalized.resultMode==='analysis' && normalized.kind === 'complete' && !normalized.evidence.length && !normalized.claims.length && !normalized.gaps.length && !normalized.recommendations.length && !normalized.steps.length) {
      violations.push(violation('C-004','analysis','A complete analysis result contains no traceable facts, gaps, recommendations, or steps.','MODEL_REPAIR',false));
    }
    return { valid:violations.length === 0, violations, decision:normalized };
  }

  repair(decision, _policyContext = null) {
    const d = clone({ ...decision, ...normalizeAnalysisFields(decision) });
    const strictBoundaries = true;
    const actions = [];
    if(d.resultMode==='analysis')d.finalResult = null;

    d.evidence = uniqueById(d.evidence).map(evidence=>{
      // Traceable source addresses are evidence, not prose repair material. Under
      // strict C-003 boundaries the Validator must never manufacture a locator
      // from basis text or manufacture an observation from the proposed claim.
      const locator=strictBoundaries?text(evidence?.locator):(text(evidence?.locator)||text(evidence?.basis));
      const observation=strictBoundaries?text(evidence?.observation):(text(evidence?.observation)||text(evidence?.statement));
      const statement=evidence?.strength===EvidenceStrength.DIRECT?observation:text(evidence?.statement);
      if(text(evidence?.statement)!==statement)actions.push({action:'CANONICALIZE_EVIDENCE',target:text(evidence?.id)||'unknown'});
      return {...evidence,id:text(evidence?.id),statement,basis:text(evidence?.basis)||locator,locator,observation};
    }).filter(evidence => {
      const sourceOk = strictBoundaries ? Object.values(EvidenceSourceType).includes(evidence?.sourceType) : (evidence?.sourceType == null || Object.values(EvidenceSourceType).includes(evidence.sourceType));
      const coverageOk = strictBoundaries ? hasCoverage(evidence?.coverage) : (evidence?.coverage == null || hasCoverage(evidence.coverage));
      const anchorsOk=!strictBoundaries||(text(evidence?.locator)&&text(evidence?.observation));
      const ok = text(evidence?.id) && text(evidence?.statement) && text(evidence?.basis) && Object.values(EvidenceStrength).includes(evidence?.strength) && Object.values(EvidenceKind).includes(evidence?.kind) && sourceOk && coverageOk && anchorsOk;
      if (!ok) actions.push({ action:'DROP_EVIDENCE', target:text(evidence?.id)||'unknown' });
      return ok;
    });
    const evidenceById = idMap(d.evidence);

    const originalGaps = uniqueById(d.gaps).filter(gap => text(gap?.id) && text(gap?.question) && text(gap?.reason) && Object.values(GapKind).includes(gap?.kind) && typeof gap?.blocking === 'boolean');
    const gapIds = new Set(originalGaps.map(g => text(g.id)).filter(Boolean));
    d.gaps = originalGaps.map(gap => ({
      ...gap,
      id:text(gap.id), question:text(gap.question), reason:text(gap.reason),
      evidenceIds:uniqueStrings(gap.evidenceIds).filter(id => evidenceById.has(id)),
    }));

    const repairedClaims = [];
    for (const raw of uniqueById(d.claims)) {
      const claim = {
        ...raw,
        id:text(raw.id), statement:text(raw.statement),
        evidenceIds:uniqueStrings(raw.evidenceIds).filter(id => evidenceById.has(id)),
        hops:Array.isArray(raw.hops) ? raw.hops.map(hop => ({
          ...hop,
          from:text(hop?.from), to:text(hop?.to),
          evidenceIds:uniqueStrings(hop?.evidenceIds).filter(id => evidenceById.has(id)),
        })) : [],
      };
      if (!claim.id || !claim.statement || !Object.values(ClaimLevel).includes(claim.level) || !Object.values(ClaimScope).includes(claim.scope) || (strictBoundaries ? !hasCoverage(claim.coverage) : (claim.coverage != null && !hasCoverage(claim.coverage)))) {
        actions.push({action:'DROP_CLAIM',target:claim.id||'unknown'});
        continue;
      }
      if (!claim.evidenceIds.length) {
        const id = gapId('AUTO-GAP',gapIds);
        d.gaps.push({ id, question:`待确认：${claim.statement}`, reason:'当前没有可追溯 Evidence 支撑该结论，不能作为 Claim 发布。', kind:GapKind.MISSING_FACT, blocking:false, evidenceIds:[] });
        actions.push({action:'CLAIM_TO_GAP',target:claim.id,gapId:id});
        continue;
      }

      let chainHasEvidence = true;
      let chainHasDirectEvidence = true;
      let chainIssue = null;
      const requirementTruth=isRequirementTruthClaim(claim,evidenceById);
      if (claim.scope === ClaimScope.CROSS_SYSTEM && !requirementTruth) {
        if (!claim.hops.length) {
          chainHasEvidence = false;
          chainHasDirectEvidence = false;
          chainIssue = '跨系统链路未拆分逐跳证据';
        } else {
          for (const hop of claim.hops) {
            if (!hop.from || !hop.to || !hop.evidenceIds.length) {
              chainHasEvidence = false;
              chainHasDirectEvidence = false;
              chainIssue = `${hop.from||'?'} → ${hop.to||'?'} 缺少可追溯证据`;
              break;
            }
            if (directEvidenceIds(hop.evidenceIds,evidenceById).length === 0) {
              chainHasDirectEvidence = false;
              chainIssue = chainIssue || `${hop.from} → ${hop.to} 缺少直接证据`;
            }
          }
        }
        if (!chainHasEvidence) {
          const id = gapId('AUTO-HOP-GAP',gapIds);
          d.gaps.push({ id, question:`待确认跨系统链路：${claim.statement}`, reason:chainIssue || '跨系统 Claim 缺少逐跳证据。', kind:GapKind.MISSING_FACT, blocking:false, evidenceIds:[...claim.evidenceIds] });
          actions.push({action:'CLAIM_TO_GAP',target:claim.id,gapId:id});
          continue;
        }
      }

      const hasDirect = directEvidenceIds(claim.evidenceIds,evidenceById).length > 0;
      const supportingEvidence = claim.evidenceIds.map(id=>evidenceById.get(id)).filter(Boolean);
      const coverageInsufficient = claim.level === ClaimLevel.CONFIRMED && hasCoverage(claim.coverage) && !coverageSupports(supportingEvidence,claim);
      const crossCoverageInvalid = claim.scope === ClaimScope.CROSS_SYSTEM && hasCoverage(claim.coverage) && claim.coverage !== EvidenceCoverage.CROSS_SYSTEM;
      if (claim.level === ClaimLevel.CONFIRMED && (!hasDirect || coverageInsufficient || crossCoverageInvalid || (claim.scope === ClaimScope.CROSS_SYSTEM && !requirementTruth && !chainHasDirectEvidence))) {
        claim.level = ClaimLevel.SUPPORTED;
        const id = gapId('AUTO-GAP',gapIds);
        d.gaps.push({ id, question:`待确认：${claim.statement}`, reason:chainIssue || (coverageInsufficient?'当前直接证据的覆盖范围小于该结论范围，不能把局部证据扩大为整体事实。':crossCoverageInvalid?'跨系统结论的覆盖范围声明不足。':'现有证据不足以把该结论标记为已确认。'), kind:GapKind.MISSING_FACT, blocking:false, evidenceIds:[...claim.evidenceIds] });
        actions.push({ action:'DOWNGRADE_TO_GAP', target:claim.id, gapId:id });
      }
      repairedClaims.push(claim);
    }
    d.claims = repairedClaims;

    const gapsById = idMap(d.gaps);
    const repairedRecommendations = [];
    for (const raw of uniqueById(d.recommendations)) {
      const rec = {
        ...raw,
        id:text(raw.id), statement:text(raw.statement), rationale:text(raw.rationale),
        evidenceIds:uniqueStrings(raw.evidenceIds).filter(id => evidenceById.has(id)),
        gapIds:uniqueStrings(raw.gapIds).filter(id => gapsById.has(id)),
      };
      if (!rec.id || !rec.statement || !rec.rationale || (!rec.evidenceIds.length && !rec.gapIds.length)) {
        actions.push({ action:'DROP_RECOMMENDATION', target:rec.id||'unknown', reason:'invalid-or-unbound' });
        continue;
      }
      repairedRecommendations.push(rec);
    }
    d.recommendations = repairedRecommendations;

    const confirmedById = new Map(d.claims.filter(c => c.level === ClaimLevel.CONFIRMED).map(c => [c.id,c]));
    const seenOrders = new Set();
    const seenSources = new Set();
    d.steps = (Array.isArray(d.steps)?d.steps:[]).flatMap(step => {
      const refs = uniqueStrings(step?.sourceIds);
      const orderValid = Number.isInteger(step?.order) && !seenOrders.has(step.order);
      if (Number.isInteger(step?.order)) seenOrders.add(step.order);
      const sources = refs.map(id=>confirmedById.get(id)).filter(Boolean);
      const refsValid = refs.length > 0 && sources.length === refs.length;
      const sourcesUnique = refs.every(id=>!seenSources.has(id));
      refs.forEach(id=>seenSources.add(id));
      if (!orderValid || !refsValid || !sourcesUnique || step?.kind !== 'confirmed') {
        actions.push({action:'DROP_STEP',target:`step:${step?.order ?? '?'}`});
        return [];
      }
      const canonical=sources.map(source=>text(source.statement)).join('；');
      if (text(step.text) !== canonical) actions.push({action:'CANONICALIZE_STEP',target:`step:${step.order}`,sourceIds:refs});
      return [{ order:step.order, text:canonical, kind:'confirmed', sourceIds:refs }];
    }).sort((a,b)=>a.order-b.order);

    // Root proposes Task knowledge; ValidatorRuntime alone decides durable History.
    if(text(d.stageResult))actions.push({action:'DROP_AGENT_STAGE_RESULT',target:'stageResult'});
    d.stageResult = null;
    if (d.resultMode==='analysis' && d.kind === 'complete') {
      const summary=canonicalAnalysisSummary(analysisViewAfterCandidateResolutions(d,evidenceById));
      if (text(d.summary)!==summary) actions.push({action:'CANONICALIZE_SUMMARY',target:'summary'});
      d.summary=summary;
    }

    return { decision:d, actions };
  }

  validateAndRepair(decision, policyContext = null) {
    const before = this.validate(decision,policyContext);
    const repaired = this.repair(before.decision,policyContext);
    const after = this.validate(repaired.decision,policyContext);
    return { valid:after.valid, decision:after.decision, violations:after.violations, originalViolations:before.violations, actions:repaired.actions };
  }
}

export function renderAnalysisResult(decision) {
  const d = normalizeAnalysisFields(decision);
  const evidenceById = idMap(d.evidence);
  const claimById = idMap(d.claims);
  const parts = [];
  const stepClaimIds = new Set();
  if (d.steps.length) {
    const rendered = d.steps.sort((a,b)=>a.order-b.order).map((step,index)=>{
      const sourceIds = uniqueStrings(step.sourceIds);
      sourceIds.forEach(id=>stepClaimIds.add(id));
      const claims = sourceIds.map(id=>claimById.get(id)).filter(Boolean);
      const bases = claims.flatMap(claim=>uniqueStrings(claim?.evidenceIds).map(id => evidenceById.get(id)?.basis).filter(Boolean));
      return `${index+1}. ${text(step.text)}${bases.length?`\n   依据：${[...new Set(bases)].join('；')}`:''}`;
    });
    parts.push(rendered.join('\n'));
  }
  const confirmed = d.claims.filter(claim => claim.level === ClaimLevel.CONFIRMED && !stepClaimIds.has(text(claim.id)));
  if (confirmed.length) {
    parts.push(`【其他已确认】\n${confirmed.map(claim => {
      const bases = uniqueStrings(claim.evidenceIds).map(id => evidenceById.get(id)?.basis).filter(Boolean);
      return `- ${text(claim.statement)}${bases.length?`\n  依据：${[...new Set(bases)].join('；')}`:''}`;
    }).join('\n')}`);
  }
  if (d.recommendations.length) parts.push(`【建议】\n${d.recommendations.map(rec=>`- ${text(rec.statement)}`).join('\n')}`);

  const pending = [];
  for (const item of pendingAnalysisItems(d)) {
    if (item.kind === 'claim') {
      const claim = claimById.get(item.id);
      const bases = uniqueStrings(claim?.evidenceIds).map(id => evidenceById.get(id)?.basis).filter(Boolean);
      pending.push(`- 当前仅有线索，需核实：${item.text}${bases.length?`\n  依据：${[...new Set(bases)].join('；')}`:''}`);
    } else {
      const gap = d.gaps.find(value => text(value.id) === item.id);
      if (gap) pending.push(`- ${text(gap.question)}`);
    }
  }
  if (pending.length) parts.push(`【待确认】\n${pending.join('\n')}`);
  return parts.join('\n\n') || '当前材料不足以形成可发布的分析结论。';
}
