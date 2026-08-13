import { resolveRequirementRefs } from './task-contract-fidelity.js';

function text(value){return String(value==null?'':value).trim();}
function supported(value){return value?.certification==='supported';}
function obligations(task){return (Array.isArray(task?.taskContract?.obligations)?task.taskContract.obligations:[]).filter(item=>text(item?.id));}
function resultText(proposal={}){return text(proposal?.finalResult)||text(proposal?.summary);}
function proofCandidate(task,obligation,proposal,excerpts,certifiedContext){const id=`completion:${text(obligation.id)}`;const requirementEvidence=excerpts.map((excerpt,index)=>({id:`${id}:requirement:${index+1}`,sourceType:'human',coverage:'component',locator:`${excerpt.sourceId}#${excerpt.start}-${excerpt.end}`,observation:excerpt.text,sourceContext:excerpt.text}));const output=resultText(proposal);return{id,targetId:text(obligation.id),candidateType:'completion_assessment',proofKind:'completion_obligation_support',statement:`The proposed Task result satisfies governed obligation ${text(obligation.id)} under criterion ${JSON.stringify(obligation?.criterion||{})}.`,criterion:obligation?.criterion||{},evidence:[...requirementEvidence,{id:`${id}:result`,sourceType:'certified_result',coverage:'component',locator:`task:${text(task?.id)}:completion-proposal`,observation:output,sourceContext:JSON.stringify({proposal,certifiedContext:certifiedContext||null})}],hops:[]};}
function unresolved(obligation,reason){return{id:`ASSESS:${text(obligation.id)}`,certification:'unresolved',obligationRefs:[text(obligation.id)],coverage:'uncovered',outcome:'unresolved',evidenceRefs:[],reason:text(reason)||'Completion proof is unresolved.'};}

export class CompletionAssessmentVerifier{
  constructor({executor=null,modelRouter=null}={}){this.executor=executor;this.modelRouter=modelRouter;}
  available(){return typeof this.executor?.runValidator==='function';}
  async review({task,proposal,policyContext=null,certifiedContext=null,onProgress=null,onExecutionStarted=null,signal=null}={}){
    const candidates=[],assessments=[];
    for(const obligation of obligations(task)){
      if(!supported(obligation)){assessments.push(unresolved(obligation,'Obligation is not Requirement-certified.'));continue;}
      const refs=obligation?.requirementRefs??obligation?.requirement_refs??[];
      const resolved=resolveRequirementRefs(task?.requirementSources??task?.requirement_sources??[],refs);
      if(!resolved.valid||!resultText(proposal)){assessments.push(unresolved(obligation,!resolved.valid?'Obligation Requirement provenance is invalid.':'Completion proposal has no result to certify.'));continue;}
      candidates.push({obligation,candidate:proofCandidate(task,obligation,proposal,resolved.excerpts,certifiedContext)});
    }
    if(!candidates.length)return{checked:assessments.length>0,assessments};
    if(!this.available()){for(const {obligation} of candidates)assessments.push(unresolved(obligation,'Validator semantic certification is unavailable.'));return{checked:true,assessments};}
    await this.modelRouter?.prepare?.({role:'validator',task});
    onProgress?.({summary:'Validator 正在核对完成条件',detail:`正在逐项核对 ${candidates.length} 个 governed obligation；不会重新调查 Task。`});
    const response=await this.executor.runValidator({task,candidates:candidates.map(item=>item.candidate),policyContext,modelPolicy:this.modelRouter?.route?.({role:'validator',task})||null,onProgress,onExecutionStarted,signal});
    const reviews=new Map((Array.isArray(response?.reviews)?response.reviews:[]).map(item=>[text(item?.id),item]).filter(([id])=>id));
    for(const {obligation,candidate} of candidates){const review=reviews.get(candidate.id);if(review?.verdict==='supported')assessments.push({id:`ASSESS:${text(obligation.id)}`,certification:'supported',obligationRefs:[text(obligation.id)],coverage:'covered',outcome:'succeeded',evidenceRefs:candidate.evidence.map(item=>item.id),reason:text(review.reason)});else assessments.push(unresolved(obligation,text(review?.reason)||'Validator did not certify obligation satisfaction.'));}
    return{checked:true,assessments};
  }
}
