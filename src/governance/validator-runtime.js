import { ClaimLevel, normalizeAnalysisFields, GapKind, EvidenceSourceType } from './analysis-contract.js';
import { SourceTraceVerifier } from './source-trace-verifier.js';
import { hasCertifiedKnowledge, normalizeCertifiedState, normalizeGapResolutions } from './certified-state.js';
import { hasGovernedCandidateDelta } from './analysis-validator.js';

function text(value){return String(value==null?'':value).trim();}
function uniqueStrings(values){return[...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];}
function compactViolation(v){return{ruleId:v?.ruleId||null,target:v?.target||null,reason:text(v?.reason),action:v?.action||null};}
function copyAnalysis(result={}){
  const fields=normalizeAnalysisFields(result);
  return{kind:result?.kind||null,summary:text(result?.summary),stageResult:result?.stageResult==null?null:text(result.stageResult),finalResult:result?.finalResult==null?null:text(result.finalResult),...fields,gateway:result?.gateway||null,gapResolutions:normalizeGapResolutions(result?.gapResolutions),delegations:Array.isArray(result?.delegations)?result.delegations:[]};
}
function itemKey(prefix,id,value){return`${prefix}:${text(id)}:${text(value)}`;}
function mergeUniqueById(primary=[],supporting=[]){
  const out=[],seen=new Set();
  for(const item of [...(Array.isArray(primary)?primary:[]),...(Array.isArray(supporting)?supporting:[])]){const id=text(item?.id);if(!id||seen.has(id))continue;seen.add(id);out.push(item);}
  return out;
}
function candidateIsEmpty(decision){return!hasGovernedCandidateDelta(decision);}
function stateSupportForCandidate(currentState){const current=normalizeCertifiedState(currentState).current;return{evidence:current.evidence||[],claims:current.claims||[],gaps:current.gaps||[]};}
function referencedEvidenceIds(candidate={}){return new Set([...(candidate?.claims||[]).flatMap(item=>item?.evidenceIds||[]),...(candidate?.gaps||[]).flatMap(item=>item?.evidenceIds||[]),...(candidate?.recommendations||[]).flatMap(item=>item?.evidenceIds||[]),...normalizeGapResolutions(candidate?.gapResolutions).flatMap(item=>item?.evidenceIds||[])].map(text).filter(Boolean));}
function selectedAvailableEvidence(candidate={},availableEvidence=[]){const wanted=referencedEvidenceIds(candidate);return(Array.isArray(availableEvidence)?availableEvidence:[]).filter(item=>wanted.has(text(item?.id)));}
function extractCandidateAfterValidation(validated,originalCandidate,support){
  const candidateEvidenceIds=new Set((originalCandidate?.evidence||[]).map(item=>text(item?.id)).filter(Boolean));
  const candidateClaimIds=new Set((originalCandidate?.claims||[]).map(item=>text(item?.id)).filter(Boolean));
  const candidateGapIds=new Set((originalCandidate?.gaps||[]).map(item=>text(item?.id)).filter(Boolean));
  const candidateRecIds=new Set((originalCandidate?.recommendations||[]).map(item=>text(item?.id)).filter(Boolean));
  const candidateStepOrders=new Set((originalCandidate?.steps||[]).map(item=>Number(item?.order)).filter(Number.isInteger));
  const supportGapIds=new Set((support?.gaps||[]).map(item=>text(item?.id)).filter(Boolean));
  return{...validated,evidence:(validated.evidence||[]).filter(item=>candidateEvidenceIds.has(text(item?.id))),claims:(validated.claims||[]).filter(item=>candidateClaimIds.has(text(item?.id))),gaps:(validated.gaps||[]).filter(item=>candidateGapIds.has(text(item?.id))||!supportGapIds.has(text(item?.id))),recommendations:(validated.recommendations||[]).filter(item=>candidateRecIds.has(text(item?.id))),steps:(validated.steps||[]).filter(item=>candidateStepOrders.has(Number(item?.order))),gapResolutions:normalizeGapResolutions(originalCandidate?.gapResolutions)};
}

/** Validator is the source-ledger accountant, not a reasoning Agent. */
export class ValidatorRuntime{
  constructor({analysisValidator=null,sourceTraceVerifier=new SourceTraceVerifier()}={}){this.analysisValidator=analysisValidator;this.sourceTraceVerifier=sourceTraceVerifier;}

  reviewRoot({decision,policyContext=null,seenKnowledgeKeys=new Set(),task=null,humanGatewayHistory=[],currentState=null,availableEvidence=[]}={}){
    if(!this.analysisValidator){
      if(!hasGovernedCandidateDelta(decision))return{outcome:'pass',decision,feedback:[],actions:[],commits:[],observedKnowledgeKeys:[]};
      const feedback=[{ruleId:'C-003',target:'validator',reason:'Governed Candidate Delta requires Validator structural certification.',action:'REQUIRE_VALIDATOR'}];
      return{outcome:'reject',decision,feedback,actions:[],commits:[],observedKnowledgeKeys:[]};
    }

    const proposed=copyAnalysis(decision);proposed.gapResolutions=normalizeGapResolutions(decision?.gapResolutions);
    const rootOwnedSourceTypes=new Set([EvidenceSourceType.HUMAN,EvidenceSourceType.REFERENCE]);
    const rootEvidence=(proposed.evidence||[]).filter(item=>rootOwnedSourceTypes.has(item?.sourceType));
    const droppedRootEvidence=(proposed.evidence||[]).filter(item=>!rootOwnedSourceTypes.has(item?.sourceType));
    proposed.evidence=mergeUniqueById(selectedAvailableEvidence(proposed,availableEvidence),rootEvidence);

    const traced=this.sourceTraceVerifier.enforce({task,evidence:proposed.evidence,humanGatewayHistory});
    proposed.evidence=traced.evidence;
    const preActions=[...droppedRootEvidence.map(item=>({action:'DROP_UNOWNED_ROOT_EVIDENCE',target:text(item?.id),reason:`Root does not own ${text(item?.sourceType)||'unknown'} evidence collection.`})),...traced.actions];
    const support=stateSupportForCandidate(currentState);
    const validationInput={...proposed,evidence:mergeUniqueById(proposed.evidence,support.evidence),claims:mergeUniqueById(proposed.claims,support.claims),gaps:mergeUniqueById(proposed.gaps,support.gaps),kind:proposed.kind==='complete'&&candidateIsEmpty(proposed)&&hasCertifiedKnowledge(currentState)?'delegate':proposed.kind};
    const checkedRaw=this.analysisValidator.validateAndRepair(validationInput,policyContext);
    const checked={...checkedRaw,decision:extractCandidateAfterValidation({...checkedRaw.decision,kind:proposed.kind},proposed,support)};
    if(checked.valid){const progress=this.deriveNewRootProgress(checked.decision,seenKnowledgeKeys);return{outcome:'pass',decision:checked.decision,feedback:[],actions:[...preActions,...checked.actions],sourceVerifications:traced.verifications,...progress};}

    // Same evidence never earns another model turn. Narrow deterministically.
    const feedback=checked.violations.map(compactViolation),safe=this.makeSafeRootResult(checked.decision,feedback),safeSupport=stateSupportForCandidate(currentState);
    const recheckedRaw=this.analysisValidator.validateAndRepair({...safe,evidence:mergeUniqueById(safe.evidence,safeSupport.evidence),claims:mergeUniqueById(safe.claims,safeSupport.claims),gaps:mergeUniqueById(safe.gaps,safeSupport.gaps),kind:safe.kind==='complete'&&candidateIsEmpty(safe)&&hasCertifiedKnowledge(currentState)?'delegate':safe.kind},policyContext);
    const rechecked={...recheckedRaw,decision:extractCandidateAfterValidation({...recheckedRaw.decision,kind:safe.kind},safe,safeSupport)};
    if(!rechecked.valid){
      const controlOnly=rechecked.violations.length>0&&rechecked.violations.every(v=>v?.target==='blocking-gap');
      if(controlOnly){const progress=this.deriveNewRootProgress(rechecked.decision,seenKnowledgeKeys);return{outcome:'pass',decision:rechecked.decision,feedback:[...feedback,...rechecked.violations.map(compactViolation)],actions:[...preActions,...checked.actions,...rechecked.actions,{action:'HANDOFF_ROOT_CONTROL_DECISION',target:'blocking-gap'}],sourceVerifications:traced.verifications,requiresRootDecision:true,...progress};}
      return{outcome:'reject',decision:rechecked.decision,feedback:rechecked.violations.map(compactViolation),actions:[...preActions,...checked.actions,...rechecked.actions],commits:[],observedKnowledgeKeys:[],sourceVerifications:traced.verifications};
    }
    const progress=this.deriveNewRootProgress(rechecked.decision,seenKnowledgeKeys);
    return{outcome:'pass',decision:rechecked.decision,feedback,actions:[...preActions,...checked.actions,...rechecked.actions,{action:'NARROW_UNSUPPORTED_ROOT_CANDIDATE',target:'root'}],sourceVerifications:traced.verifications,...progress};
  }

  makeSafeRootResult(decision,feedback=[]){
    const d=copyAnalysis(decision),gapId='VALIDATOR-ROOT-GAP';
    if(!d.gaps.some(g=>text(g?.id)===gapId)){
      const claimsById=new Map((d.claims||[]).map(claim=>[text(claim?.id),claim]).filter(([id])=>id));
      const unresolvedStatements=uniqueStrings((feedback||[]).map(item=>text(claimsById.get(text(item?.target).replace(/^claim:/,''))?.statement)));
      d.gaps.push({id:gapId,question:unresolvedStatements.length?`待确认：${unresolvedStatements.join('；')}`:'待确认：当前仍有结论缺少足够可追溯证据。',reason:`Validator 的来源/结构核对未能支持该部分作为已确认事实。${feedback.length?` 主要缺口：${feedback.slice(0,4).map(v=>v.reason).join('；')}`:''}`,kind:GapKind.MISSING_FACT,blocking:false,evidenceIds:[]});
    }
    d.stageResult=null;d.finalResult=null;return d;
  }

  deriveNewRootProgress(decision,seenKnowledgeKeys=new Set()){
    const d=copyAnalysis(decision),unseenClaims=[],unseenGaps=[],resolutions=normalizeGapResolutions(d.gapResolutions);
    for(const claim of d.claims){if(claim?.level!==ClaimLevel.CONFIRMED||!text(claim?.id)||!text(claim?.statement))continue;const key=itemKey('claim',claim.id,claim.statement);if(!seenKnowledgeKeys.has(key))unseenClaims.push({item:claim,key});}
    for(const gap of d.gaps){if(!text(gap?.id)||!text(gap?.question))continue;const key=itemKey('gap',gap.id,`${gap.question}|${gap.reason||''}`);if(!seenKnowledgeKeys.has(key))unseenGaps.push({item:gap,key});}
    if(!unseenClaims.length&&!unseenGaps.length&&!resolutions.length){if(decision&&typeof decision==='object')delete decision.__historyCommit;return{commits:[],observedKnowledgeKeys:[]};}
    const claimTexts=unseenClaims.map(({item})=>text(item.statement)).filter(Boolean),gapTexts=unseenGaps.map(({item})=>text(item.question).replace(/^待确认[：:]\s*/,'')).filter(Boolean),resolvedTexts=resolutions.map(item=>text(item.reason)).filter(Boolean),detailParts=[];
    if(claimTexts.length)detailParts.push(claimTexts.join('；'));if(gapTexts.length)detailParts.push(`待确认：${gapTexts.join('；')}`);if(resolvedTexts.length)detailParts.push(`已闭合：${resolvedTexts.join('；')}`);
    const title=claimTexts.length&&gapTexts.length?'阶段结论已收敛':claimTexts.length?'阶段事实已确认':resolvedTexts.length&&!gapTexts.length?'待确认边界已闭合':'待确认边界已收敛';
    const sourceIds=[...unseenClaims.map(({item})=>text(item.id)),...unseenGaps.map(({item})=>text(item.id)),...resolutions.map(item=>text(item.gapId))].filter(Boolean),observedKnowledgeKeys=[...unseenClaims.map(({key})=>key),...unseenGaps.map(({key})=>key)];
    const commit={title,detail:detailParts.join('；'),sourceIds};if(decision&&typeof decision==='object')decision.__historyCommit={...commit,sourceIds:[...sourceIds]};return{commits:[commit],observedKnowledgeKeys};
  }
}
