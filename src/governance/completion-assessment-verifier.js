import { ClaimLevel } from './analysis-contract.js';
import { resolveRequirementRefs } from './task-contract-fidelity.js';

function text(value){return String(value==null?'':value).trim();}
function supported(value){return value?.certification==='supported';}
function obligations(task){return (Array.isArray(task?.taskContract?.obligations)?task.taskContract.obligations:[]).filter(item=>text(item?.id));}
function resultText(proposal={}){return text(proposal?.finalResult)||text(proposal?.summary)||text(proposal?.stageResult);}
function proposalClaim(proposal={}){return{finalResult:text(proposal?.finalResult)||null,summary:text(proposal?.summary)||null,stageResult:text(proposal?.stageResult)||null};}
function requirementContext(excerpts=[]){return excerpts.map(excerpt=>({sourceId:text(excerpt?.sourceId),start:Number(excerpt?.start),end:Number(excerpt?.end),text:text(excerpt?.text)}));}

// Completion proves a governed obligation from already-certified Task facts.
// Claim -> Evidence was certified earlier by Validator; do not resend the raw
// Evidence ledger to another model turn. Only CONFIRMED Task-level Claims can
// prove completion. SUPPORTED/inferred material remains useful context for Root,
// but is not completion proof.
function certifiedProofMaterial(certifiedContext={}){
  return (Array.isArray(certifiedContext?.claims)?certifiedContext.claims:[])
    .filter(item=>text(item?.id)&&text(item?.statement)&&item?.level===ClaimLevel.CONFIRMED)
    .map(item=>({
      id:text(item.id),
      statement:text(item.statement),
      level:ClaimLevel.CONFIRMED,
      coverage:item?.coverage??null,
      scope:item?.scope??null,
      evidenceIds:(Array.isArray(item?.evidenceIds)?item.evidenceIds:[]).map(text).filter(Boolean),
    }));
}
function proofRelation(obligation,proofMaterial){
  return{
    proofKind:'completion_obligation_support',
    subject:{obligationId:text(obligation.id)},
    criterion:obligation?.criterion||{},
    certifiedFactRefs:proofMaterial.map(item=>text(item?.id)).filter(Boolean),
    claim:'Certified Task Claims in proofMaterial are sufficient to satisfy this governed Criterion.',
    requirementContextRole:'Requirement provenance defines what is required and the governed Criterion; it is not completion evidence.',
    proposalRole:'Completion proposal is the candidate claim under review; it is not proof.',
    supportRule:'Return supported only when the supplied CONFIRMED Task Claims alone satisfy the entire Criterion; partial proof is overreach.',
    forbiddenProofSources:['raw Evidence ledger','SUPPORTED/inferred Claim','completion proposal','Requirement wording alone','bare WorkReceipt','WorkUnit obligationRefs','taskMode','TaskStatus','completionReason','Scheduler lifecycle','UI Completed'],
  };
}
function proofCandidate(task,obligation,proposal,excerpts,proofMaterial){
  const id=`completion:${text(obligation.id)}`;
  const relation=proofRelation(obligation,proofMaterial);
  return{
    id,
    targetId:text(obligation.id),
    candidateType:'completion_assessment',
    proofKind:'completion_obligation_support',
    statement:relation.claim,
    proofRelation:relation,
    obligation:{id:text(obligation.id),criterion:obligation?.criterion||{}},
    criterion:obligation?.criterion||{},
    requirementContext:requirementContext(excerpts),
    proposal:proposalClaim(proposal),
    proofMaterial,
    hops:[],
  };
}
function unresolved(obligation,reason){return{id:`ASSESS:${text(obligation.id)}`,proofKind:'completion_obligation_support',certification:'unresolved',obligationRefs:[text(obligation.id)],criterionSatisfied:false,proofFactRefs:[],reason:text(reason)||'Completion proof is unresolved.'};}

export class CompletionAssessmentVerifier{
  constructor({executor=null,modelRouter=null}={}){this.executor=executor;this.modelRouter=modelRouter;}
  available(){return typeof this.executor?.runValidator==='function';}
  async review({task,proposal,policyContext=null,certifiedContext=null,onProgress=null,onExecutionStarted=null,signal=null}={}){
    const candidates=[],assessments=[];
    const proofMaterial=certifiedProofMaterial(certifiedContext||{});
    for(const obligation of obligations(task)){
      if(!supported(obligation)){assessments.push(unresolved(obligation,'Obligation is not Requirement-certified.'));continue;}
      const refs=obligation?.requirementRefs??obligation?.requirement_refs??[];
      const resolved=resolveRequirementRefs(task?.requirementSources??task?.requirement_sources??[],refs);
      if(!resolved.valid||!resultText(proposal)){assessments.push(unresolved(obligation,!resolved.valid?'Obligation Requirement provenance is invalid.':'Completion proposal has no result to certify.'));continue;}
      if(!proofMaterial.length){assessments.push(unresolved(obligation,'No CONFIRMED Task Claims are available to prove the completion criterion.'));continue;}
      candidates.push({obligation,candidate:proofCandidate(task,obligation,proposal,resolved.excerpts,proofMaterial)});
    }
    if(!candidates.length)return{checked:assessments.length>0,assessments};
    if(!this.available()){for(const {obligation} of candidates)assessments.push(unresolved(obligation,'Validator semantic certification is unavailable.'));return{checked:true,assessments};}
    await this.modelRouter?.prepare?.({role:'validator',task});
    onProgress?.({summary:'Validator 正在核对完成条件',detail:`正在逐项核对 ${candidates.length} 个 governed obligation；只使用已认证 Task Claims，不重新提交原始 Evidence 或调查 Task。`});
    const response=await this.executor.runValidator({task,candidates:candidates.map(item=>item.candidate),policyContext,modelPolicy:this.modelRouter?.route?.({role:'validator',task})||null,onProgress,onExecutionStarted,signal});
    const reviews=new Map((Array.isArray(response?.reviews)?response.reviews:[]).map(item=>[text(item?.id),item]).filter(([id])=>id));
    for(const {obligation,candidate} of candidates){
      const review=reviews.get(candidate.id);
      if(review?.verdict==='supported')assessments.push({id:`ASSESS:${text(obligation.id)}`,proofKind:'completion_obligation_support',certification:'supported',obligationRefs:[text(obligation.id)],criterionSatisfied:true,proofFactRefs:candidate.proofRelation.certifiedFactRefs,reason:text(review.reason)});
      else assessments.push(unresolved(obligation,text(review?.reason)||'Validator did not certify obligation satisfaction.'));
    }
    return{checked:true,assessments};
  }
}