import { ClaimLevel, normalizeAnalysisFields } from './analysis-contract.js';

function text(value){return String(value==null?'':value).trim();}
function list(value){return Array.isArray(value)?value:[];}
function uniqueStrings(values){return[...new Set(list(values).map(text).filter(Boolean))];}
function idMap(items){return new Map(list(items).map(item=>[text(item?.id),item]).filter(([id])=>id));}

/**
 * Presentation helpers only. Semantic judgment belongs to Root; source/provenance
 * validation belongs to ValidatorRuntime; durable merge belongs to CertifiedState.
 */
export function pendingAnalysisItems(decision){
  const gaps=list(decision?.gaps);
  const supported=list(decision?.claims).filter(claim=>claim?.level===ClaimLevel.SUPPORTED).filter(claim=>{
    const statement=text(claim?.statement);return statement&&!gaps.some(gap=>text(gap?.question).includes(statement));
  });
  return[
    ...supported.map(claim=>({kind:'claim',id:text(claim.id),text:text(claim.statement)})),
    ...gaps.map(gap=>({kind:'gap',id:text(gap.id),text:text(gap.question)})),
  ];
}

export function hasGovernedCandidateDelta(decision={}){
  const normalized=normalizeAnalysisFields(decision);
  return['evidence','claims','gaps','recommendations','steps'].some(key=>list(normalized[key]).length>0)||list(decision?.gapResolutions).length>0;
}

export function canonicalAnalysisSummary(decision){
  const confirmed=list(decision?.claims).filter(claim=>claim?.level===ClaimLevel.CONFIRMED).length,pending=pendingAnalysisItems(decision).length,recommendations=list(decision?.recommendations).length,parts=[`${confirmed} 项已确认`];
  if(pending)parts.push(`${pending} 项待确认`);if(recommendations)parts.push(`${recommendations} 项建议`);return`分析已完成：${parts.join('，')}。`;
}

export function renderAnalysisResult(decision){
  const d=normalizeAnalysisFields(decision),evidenceById=idMap(d.evidence),claimById=idMap(d.claims),parts=[],stepClaimIds=new Set();
  if(d.steps.length){
    const rendered=[...d.steps].sort((a,b)=>a.order-b.order).map((step,index)=>{
      const sourceIds=uniqueStrings(step.sourceIds);sourceIds.forEach(id=>stepClaimIds.add(id));const claims=sourceIds.map(id=>claimById.get(id)).filter(Boolean),bases=claims.flatMap(claim=>uniqueStrings(claim?.evidenceIds).map(id=>evidenceById.get(id)?.basis).filter(Boolean));return`${index+1}. ${text(step.text)}${bases.length?`\n   依据：${[...new Set(bases)].join('；')}`:''}`;
    });
    parts.push(rendered.join('\n'));
  }
  const confirmed=d.claims.filter(claim=>claim.level===ClaimLevel.CONFIRMED&&!stepClaimIds.has(text(claim.id)));
  if(confirmed.length)parts.push(`【其他已确认】\n${confirmed.map(claim=>{const bases=uniqueStrings(claim.evidenceIds).map(id=>evidenceById.get(id)?.basis).filter(Boolean);return`- ${text(claim.statement)}${bases.length?`\n  依据：${[...new Set(bases)].join('；')}`:''}`;}).join('\n')}`);
  if(d.recommendations.length)parts.push(`【建议】\n${d.recommendations.map(rec=>`- ${text(rec.statement)}`).join('\n')}`);
  const pending=[];
  for(const item of pendingAnalysisItems(d)){
    if(item.kind==='claim'){const claim=claimById.get(item.id),bases=uniqueStrings(claim?.evidenceIds).map(id=>evidenceById.get(id)?.basis).filter(Boolean);pending.push(`- 当前仅有线索，需核实：${item.text}${bases.length?`\n  依据：${[...new Set(bases)].join('；')}`:''}`);}
    else{const gap=d.gaps.find(value=>text(value.id)===item.id);if(gap)pending.push(`- ${text(gap.question)}`);}
  }
  if(pending.length)parts.push(`【待确认】\n${pending.join('\n')}`);
  return parts.join('\n\n')||'当前材料不足以形成可发布的分析结论。';
}
