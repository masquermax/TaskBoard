import { ClaimLevel, normalizeAnalysisFields } from './analysis-contract.js';

function text(value){return String(value==null?'':value).trim();}
function list(value){return Array.isArray(value)?value:[];}
function uniqueStrings(values){return[...new Set(list(values).map(text).filter(Boolean))];}
function idMap(items){return new Map(list(items).map(item=>[text(item?.id),item]).filter(([id])=>id));}
function claimEvidence(claim,evidenceById){return uniqueStrings(claim?.evidenceIds).map(id=>evidenceById.get(id)).filter(Boolean);}
function claimPresentationKind(claim,evidenceById){const evidence=claimEvidence(claim,evidenceById);return evidence.length&&evidence.every(item=>item?.strength!=='direct')?'reference':'inference';}
function claimBases(claim,evidenceById){return[...new Set(claimEvidence(claim,evidenceById).map(item=>text(item?.basis)).filter(Boolean))];}

/**
 * Presentation only. Root owns semantic judgment, Validator owns source/accounting
 * checks, and CertifiedState owns durable merge. This module never upgrades,
 * downgrades, repairs, or reinterprets a Claim.
 */
export function pendingAnalysisItems(decision){
  const d=normalizeAnalysisFields(decision),evidenceById=idMap(d.evidence);
  return[
    ...d.claims.filter(claim=>claim?.level===ClaimLevel.SUPPORTED).map(claim=>({kind:'claim',mode:claimPresentationKind(claim,evidenceById),id:text(claim.id),text:text(claim.statement)})),
    ...d.gaps.map(gap=>({kind:'gap',mode:'unknown',id:text(gap.id),text:text(gap.question)})),
  ];
}

export function hasGovernedCandidateDelta(decision={}){
  const normalized=normalizeAnalysisFields(decision);
  return['evidence','claims','gaps','recommendations','steps'].some(key=>list(normalized[key]).length>0)||list(decision?.gapResolutions).length>0;
}

export function canonicalAnalysisSummary(decision){
  const d=normalizeAnalysisFields(decision),evidenceById=idMap(d.evidence),confirmed=d.claims.filter(claim=>claim?.level===ClaimLevel.CONFIRMED).length,supported=d.claims.filter(claim=>claim?.level===ClaimLevel.SUPPORTED),reference=supported.filter(claim=>claimPresentationKind(claim,evidenceById)==='reference').length,inference=supported.length-reference,unknown=d.gaps.length,recommendations=d.recommendations.length,parts=[`${confirmed} 项已确认`];
  if(inference)parts.push(`${inference} 项有依据推断`);if(reference)parts.push(`${reference} 项仅供参考`);if(unknown)parts.push(`${unknown} 项仍未知`);if(recommendations)parts.push(`${recommendations} 项建议`);return`分析已完成：${parts.join('，')}。`;
}

export function renderAnalysisResult(decision){
  const d=normalizeAnalysisFields(decision),evidenceById=idMap(d.evidence),claimById=idMap(d.claims),parts=[],stepClaimIds=new Set();
  if(d.steps.length){
    const rendered=[...d.steps].sort((a,b)=>a.order-b.order).map((step,index)=>{
      const sourceIds=uniqueStrings(step.sourceIds);sourceIds.forEach(id=>stepClaimIds.add(id));const bases=sourceIds.map(id=>claimById.get(id)).filter(Boolean).flatMap(claim=>claimBases(claim,evidenceById));return`${index+1}. ${text(step.text)}${bases.length?`\n   依据：${[...new Set(bases)].join('；')}`:''}`;
    });
    parts.push(rendered.join('\n'));
  }
  const confirmed=d.claims.filter(claim=>claim.level===ClaimLevel.CONFIRMED&&!stepClaimIds.has(text(claim.id)));
  if(confirmed.length)parts.push(`【其他已确认】\n${confirmed.map(claim=>{const bases=claimBases(claim,evidenceById);return`- ${text(claim.statement)}${bases.length?`\n  依据：${bases.join('；')}`:''}`;}).join('\n')}`);

  const supported=d.claims.filter(claim=>claim.level===ClaimLevel.SUPPORTED),inferences=supported.filter(claim=>claimPresentationKind(claim,evidenceById)==='inference'),references=supported.filter(claim=>claimPresentationKind(claim,evidenceById)==='reference');
  if(inferences.length)parts.push(`【有依据的推断】\n${inferences.map(claim=>{const bases=claimBases(claim,evidenceById);return`- ${text(claim.statement)}${bases.length?`\n  依据：${bases.join('；')}`:''}`;}).join('\n')}`);
  if(references.length)parts.push(`【仅供参考】\n${references.map(claim=>{const bases=claimBases(claim,evidenceById);return`- ${text(claim.statement)}${bases.length?`\n  来源：${bases.join('；')}`:''}`;}).join('\n')}`);
  if(d.gaps.length)parts.push(`【仍未知】\n${d.gaps.map(gap=>`- ${text(gap.question)}${text(gap.reason)?`\n  原因：${text(gap.reason)}`:''}`).join('\n')}`);
  if(d.recommendations.length)parts.push(`【建议】\n${d.recommendations.map(rec=>`- ${text(rec.statement)}`).join('\n')}`);
  return parts.join('\n\n')||'当前材料不足以形成可发布的分析结论。';
}
