import { ClaimLevel, EvidenceSourceType, normalizeAnalysisFields } from './analysis-contract.js';
import { SourceTraceVerifier } from './source-trace-verifier.js';
import { normalizeCertifiedState, normalizeGapResolutions } from './certified-state.js';

function text(value){return String(value==null?'':value).trim();}
function list(value){return Array.isArray(value)?value:[];}
function uniqueStrings(values){return[...new Set(list(values).map(text).filter(Boolean))];}
function sameStringSet(a,b){const left=uniqueStrings(a).sort(),right=uniqueStrings(b).sort();return left.length===right.length&&left.every((value,index)=>value===right[index]);}
function copyAnalysis(result={}){
  const fields=normalizeAnalysisFields(result);
  return{kind:result?.kind||null,summary:text(result?.summary),finalResult:result?.finalResult==null?null:text(result.finalResult),...fields,gateway:result?.gateway||null,gapResolutions:normalizeGapResolutions(result?.gapResolutions),delegations:list(result?.delegations),effectClosures:list(result?.effectClosures)};
}
function byId(values=[]){return new Map(list(values).map(item=>[text(item?.id),item]).filter(([id])=>id));}
function mergeUniqueById(...groups){const out=[],seen=new Set();for(const item of groups.flatMap(group=>list(group))){const id=text(item?.id);if(!id||seen.has(id))continue;seen.add(id);out.push(item);}return out;}
function refsExist(ids,map){const refs=uniqueStrings(ids);return{refs,missing:refs.filter(id=>!map.has(id))};}
function feedback(target,reason,action='REJECT_LEDGER_ENTRY'){return{ruleId:'C-003',target,reason,action};}
function rejectionBoundary(task,currentState,availableEvidence=[]){return JSON.stringify({taskId:text(task?.id)||'task',stateVersion:normalizeCertifiedState(currentState).version,evidenceIds:uniqueStrings(list(availableEvidence).map(item=>item?.id)).sort()});}
function rejectionFingerprint(violations=[]){return JSON.stringify(list(violations).map(item=>({ruleId:text(item?.ruleId),target:text(item?.target),reason:text(item?.reason),action:text(item?.action)})));}

function persistedWorkSubjectRefs(task){
  const byEvidenceId=new Map();
  for(const receipt of list(task?.workReceipts)){
    const subjectRefs=uniqueStrings(receipt?.workUnit?.subjectRefs);
    if(!subjectRefs.length)continue;
    for(const item of list(receipt?.result?.evidence)){
      const id=text(item?.id);if(!id)continue;
      byEvidenceId.set(id,uniqueStrings([...(byEvidenceId.get(id)||[]),...subjectRefs]));
    }
  }
  return byEvidenceId;
}

function workSubjectRefsForEvidence(task,selectedWorkEvidence=[]){
  const byEvidenceId=persistedWorkSubjectRefs(task);
  for(const item of list(selectedWorkEvidence)){
    const id=text(item?.id),transient=uniqueStrings(item?._workSubjectRefs);if(!id||!transient.length)continue;
    byEvidenceId.set(id,uniqueStrings([...(byEvidenceId.get(id)||[]),...transient]));
  }
  return byEvidenceId;
}

function ledgerViolations(decision,evidenceById,currentState,workSubjectRefsByEvidenceId=new Map()){
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

      // Concrete subject identity is part of provenance, not free Root prose.
      // Runtime binds live Evidence to its Work subject, and persisted WorkReceipt
      // reconstructs the same binding after process/session restart. A CONFIRMED
      // Claim must preserve that concrete Work boundary so server B Reality cannot
      // later become server A (or ambient/general) cognition.
      const workSubjectRefs=uniqueStrings(checked.refs.flatMap(ref=>list(workSubjectRefsByEvidenceId.get(ref))));
      if(workSubjectRefs.length&&!sameStringSet(claim?.subjectRefs,workSubjectRefs)){
        violations.push(feedback(
          `claim:${id}`,
          `CONFIRMED 结论的 subjectRefs 与实际产生其 Work Evidence 的对象边界不一致：Claim=[${uniqueStrings(claim?.subjectRefs).join(', ')}]，Evidence Work=[${workSubjectRefs.join(', ')}]。`,
          'REJECT_SUBJECT_PROVENANCE_MISMATCH'
        ));
      }
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
    if(!checked.refs.length)violations.push(feedback(`gap:${id}`,'Gap resolution 没有来源凭证；不能把不确定性静默删除。','REJECT_TRUST_ESCALATION'));
    if(checked.missing.length)violations.push(feedback(`gap:${id}`,`Gap resolution 引用了不存在的 Evidence：${checked.missing.join(', ')}。`));
    if(checked.refs.length&&!checked.refs.some(ref=>evidenceById.get(ref)?.strength==='direct'))violations.push(feedback(`gap:${id}`,'Gap resolution 没有 DIRECT 来源凭证；不能把不确定性静默删除。','REJECT_TRUST_ESCALATION'));
  }

  for(const rec of list(decision.recommendations)){
    const id=text(rec?.id)||'recommendation',evidence=refsExist(rec?.evidenceIds,evidenceById),gaps=uniqueStrings(rec?.gapIds).filter(ref=>!gapById.has(ref));
    if(evidence.missing.length)violations.push(feedback(`recommendation:${id}`,`Recommendation 引用了不存在的 Evidence：${evidence.missing.join(', ')}。`));
    if(gaps.length)violations.push(feedback(`recommendation:${id}`,`Recommendation 引用了不存在的 Gap：${gaps.join(', ')}。`));
  }

  for(const step of list(decision.steps)){
    const refs=uniqueStrings(step?.sourceIds),missing=refs.filter(ref=>!claimById.has(ref));
    if(missing.length)violations.push(feedback(`step:${step?.order??'?'}`,`Step 引用了不存在的 Claim：${missing.join(', ')}。`));
    const unconfirmed=refs.map(ref=>claimById.get(ref)).filter(Boolean).filter(claim=>claim?.level!==ClaimLevel.CONFIRMED).map(claim=>text(claim?.id)).filter(Boolean);
    if(unconfirmed.length)violations.push(feedback(`step:${step?.order??'?'}`,`已确认 Step 依赖未确认 Claim：${unconfirmed.join(', ')}；展示可信度不能高于来源 Claim。`,'REJECT_TRUST_ESCALATION'));
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
  constructor({sourceTraceVerifier=new SourceTraceVerifier()}={}){this.sourceTraceVerifier=sourceTraceVerifier;this.lastRejectionByTask=new Map();}

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
    const workSubjectRefsByEvidenceId=workSubjectRefsForEvidence(task,selectedWorkEvidence);
    proposed.evidence=mergeUniqueById(selectedWorkEvidence,rootEvidence);

    const traced=this.sourceTraceVerifier.enforce({task,evidence:proposed.evidence,humanGatewayHistory});
    proposed.evidence=traced.evidence;
    const evidenceById=byId(mergeUniqueById(current.evidence,proposed.evidence));
    const violations=[];

    for(const item of unownedRootEvidence)violations.push(feedback(`evidence:${text(item?.id)||'unknown'}`,`Root 不能自行制造 ${text(item?.sourceType)||'unknown'} Evidence；该来源必须来自执行结果或系统持有的真实来源。`,'REJECT_UNOWNED_ROOT_EVIDENCE'));
    for(const action of list(traced.actions))if(action?.action==='REJECT_UNTRACEABLE_SOURCE')violations.push(feedback(`evidence:${text(action?.target)||'unknown'}`,text(action?.reason)||'Evidence 来源无法追溯。','REJECT_UNTRACEABLE_SOURCE'));
    violations.push(...ledgerViolations(proposed,evidenceById,currentState,workSubjectRefsByEvidenceId));

    const taskId=text(task?.id)||'task';
    if(violations.length){
      const boundary=rejectionBoundary(task,currentState,availableEvidence),fingerprint=rejectionFingerprint(violations),previous=this.lastRejectionByTask.get(taskId);
      if(previous?.boundary===boundary&&previous?.fingerprint===fingerprint){
        this.lastRejectionByTask.delete(taskId);
        const error=new Error(`VALIDATOR_REJECTION_NON_CONVERGENCE: same deterministic rejection repeated without new Certified State or Evidence (${violations.map(item=>item.action||item.ruleId).join(', ')})`);
        error.nonRetryable=true;error.validatorFeedback=violations;throw error;
      }
      this.lastRejectionByTask.set(taskId,{boundary,fingerprint});
      return{outcome:'reject',decision:proposed,feedback:violations,actions:[...list(traced.actions)],sourceVerifications:traced.verifications};
    }
    this.lastRejectionByTask.delete(taskId);
    return{outcome:'pass',decision:proposed,feedback:[],actions:[...list(traced.actions)],sourceVerifications:traced.verifications};
  }
}
