import { ClaimLevel, EvidenceSourceType, normalizeAnalysisFields } from './analysis-contract.js';
import { SourceTraceVerifier } from './source-trace-verifier.js';
import { normalizeCertifiedState, normalizeGapResolutions } from './certified-state.js';

function text(value){return String(value==null?'':value).trim();}
function list(value){return Array.isArray(value)?value:[];}
function uniqueStrings(values){return[...new Set(list(values).map(text).filter(Boolean))];}
function copyAnalysis(result={}){
  const fields=normalizeAnalysisFields(result);
  return{kind:result?.kind||null,summary:text(result?.summary),finalResult:result?.finalResult==null?null:text(result.finalResult),...fields,gateway:result?.gateway||null,gapResolutions:normalizeGapResolutions(result?.gapResolutions),delegations:list(result?.delegations),effectClosures:list(result?.effectClosures)};
}
function byId(values=[]){return new Map(list(values).map(item=>[text(item?.id),item]).filter(([id])=>id));}
function mergeUniqueById(...groups){const out=[],seen=new Set();for(const item of groups.flatMap(group=>list(group))){const id=text(item?.id);if(!id||seen.has(id))continue;seen.add(id);out.push(item);}return out;}
function refsExist(ids,map){const refs=uniqueStrings(ids);return{refs,missing:refs.filter(id=>!map.has(id))};}
function feedback(target,reason,action='REJECT_LEDGER_ENTRY'){return{ruleId:'C-003',target,reason,action};}

function ledgerViolations(decision,evidenceById,currentState){
  const violations=[];
  const claimById=byId([...list(normalizeCertifiedState(currentState).current.claims),...list(decision.claims)]);
  const gapById=byId([...list(normalizeCertifiedState(currentState).current.gaps),...list(decision.gaps)]);

  for(const claim of list(decision.claims)){
    const id=text(claim?.id)||'claim';
    if(!text(claim?.statement))violations.push(feedback(`claim:${id}`,'Claim 缺少 statement。'));
    const checked=refsExist(claim?.evidenceIds,evidenceById);
    if(!checked.refs.length)violations.push(feedback(`claim:${id}`,'Claim 没有真实来源凭证；未知内容必须由 Root 表达为 Gap。'));
    if(checked.missing.length)violations.push(feedback(`claim:${id}`,`Claim 引用了不存在或已被来源核对拒绝的 Evidence：${checked.missing.join(', ')}。`));
    if(claim?.level===ClaimLevel.CONFIRMED){
      const indirect=checked.refs.map(ref=>evidenceById.get(ref)).filter(Boolean).filter(item=>item?.strength!=='direct');
      if(indirect.length)violations.push(feedback(`claim:${id}`,`CONFIRMED 结论依赖未验证/INDIRECT 来源：${indirect.map(item=>text(item?.id)).filter(Boolean).join(', ')}；结论可信度不能高于来源。`,'REJECT_TRUST_ESCALATION'));
    }
    for(const hop of list(claim?.hops)){
      const hopChecked=refsExist(hop?.evidenceIds,evidenceById);
      if(hopChecked.missing.length)violations.push(feedback(`claim:${id}`,`Claim hop ${text(hop?.from)||'?'} -> ${text(hop?.to)||'?'} 引用了不存在的 Evidence：${hopChecked.missing.join(', ')}。`));
      if(claim?.level===ClaimLevel.CONFIRMED&&hopChecked.refs.some(ref=>evidenceById.get(ref)?.strength!=='direct'))violations.push(feedback(`claim:${id}`,'CONFIRMED hop 依赖 INDIRECT 来源；不能升级为已确认。','REJECT_TRUST_ESCALATION'));
    }
  }

  for(const gap of list(decision.gaps)){
    const id=text(gap?.id)||'gap',checked=refsExist(gap?.evidenceIds,evidenceById);
    if(checked.missing.length)violations.push(feedback(`gap:${id}`,`Gap 引用了不存在的 Evidence：${checked.missing.join(', ')}。`));
  }

  for(const resolution of normalizeGapResolutions(decision?.gapResolutions)){
    const id=text(resolution?.gapId)||'gap',checked=refsExist(resolution?.evidenceIds,evidenceById);
    if(!gapById.has(id))violations.push(feedback(`gap:${id}`,'Gap resolution 指向不存在的 Gap。'));
    if(checked.missing.length)violations.push(feedback(`gap:${id}`,`Gap resolution 引用了不存在的 Evidence：${checked.missing.join(', ')}。`));
    if(checked.refs.length&&!checked.refs.some(ref=>evidenceById.get(ref)?.strength==='direct'))violations.push(feedback(`gap:${id}`,'Gap resolution 没有 DIRECT 来源凭证；不能把不确定性静默删除。','REJECT_TRUST_ESCALATION'));
  }

  for(const rec of list(decision.recommendations)){
    const id=text(rec?.id)||'recommendation',evidence=refsExist(rec?.evidenceIds,evidenceById),gaps=uniqueStrings(rec?.gapIds).filter(ref=>!gapById.has(ref));
    if(evidence.missing.length)violations.push(feedback(`recommendation:${id}`,`Recommendation 引用了不存在的 Evidence：${evidence.missing.join(', ')}。`));
    if(gaps.length)violations.push(feedback(`recommendation:${id}`,`Recommendation 引用了不存在的 Gap：${gaps.join(', ')}。`));
  }

  for(const step of list(decision.steps)){
    const missing=uniqueStrings(step?.sourceIds).filter(ref=>!claimById.has(ref));
    if(missing.length)violations.push(feedback(`step:${step?.order??'?'}`,`Step 引用了不存在的 Claim：${missing.join(', ')}。`));
  }
  return violations;
}

/**
 * Validator is an invoice checker, not a reasoning Agent.
 * It verifies source existence/locator fidelity and reference integrity only.
 * It never re-investigates, repairs Root prose, invents a Gap, or asks Root/model
 * to reinterpret the same material. Root owns every semantic judgment.
 */
export class ValidatorRuntime{
  constructor({sourceTraceVerifier=new SourceTraceVerifier()}={}){this.sourceTraceVerifier=sourceTraceVerifier;}

  reviewRoot({decision,task=null,humanGatewayHistory=[],currentState=null,availableEvidence=[]}={}){
    const proposed=copyAnalysis(decision);
    const current=normalizeCertifiedState(currentState).current;
    const rootOwnedSourceTypes=new Set([EvidenceSourceType.HUMAN,EvidenceSourceType.REFERENCE]);
    const rootEvidence=list(proposed.evidence).filter(item=>rootOwnedSourceTypes.has(item?.sourceType));
    const unownedRootEvidence=list(proposed.evidence).filter(item=>!rootOwnedSourceTypes.has(item?.sourceType));
    const wanted=new Set([
      ...list(proposed.claims).flatMap(item=>uniqueStrings(item?.evidenceIds)),
      ...list(proposed.gaps).flatMap(item=>uniqueStrings(item?.evidenceIds)),
      ...list(proposed.recommendations).flatMap(item=>uniqueStrings(item?.evidenceIds)),
      ...normalizeGapResolutions(proposed.gapResolutions).flatMap(item=>uniqueStrings(item?.evidenceIds)),
      ...list(proposed.claims).flatMap(item=>list(item?.hops).flatMap(hop=>uniqueStrings(hop?.evidenceIds))),
    ]);
    const selectedWorkEvidence=list(availableEvidence).filter(item=>wanted.has(text(item?.id)));
    proposed.evidence=mergeUniqueById(selectedWorkEvidence,rootEvidence);

    const traced=this.sourceTraceVerifier.enforce({task,evidence:proposed.evidence,humanGatewayHistory});
    proposed.evidence=traced.evidence;
    const evidenceById=byId(mergeUniqueById(current.evidence,proposed.evidence));
    const violations=[];

    for(const item of unownedRootEvidence)violations.push(feedback(`evidence:${text(item?.id)||'unknown'}`,`Root 不能自行制造 ${text(item?.sourceType)||'unknown'} Evidence；该来源必须来自执行结果或系统持有的真实来源。`,'REJECT_UNOWNED_ROOT_EVIDENCE'));
    for(const action of list(traced.actions))if(action?.action==='REJECT_UNTRACEABLE_SOURCE')violations.push(feedback(`evidence:${text(action?.target)||'unknown'}`,text(action?.reason)||'Evidence 来源无法追溯。','REJECT_UNTRACEABLE_SOURCE'));
    violations.push(...ledgerViolations(proposed,evidenceById,currentState));

    if(violations.length)return{outcome:'reject',decision:proposed,feedback:violations,actions:[...list(traced.actions)],sourceVerifications:traced.verifications};
    return{outcome:'pass',decision:proposed,feedback:[],actions:[...list(traced.actions)],sourceVerifications:traced.verifications};
  }
}
