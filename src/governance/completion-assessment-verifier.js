import { ClaimLevel } from './analysis-contract.js';
import { resolveRequirementRefs } from './task-contract-fidelity.js';

function text(value){return String(value==null?'':value).trim();}
function supported(value){return value?.certification==='supported';}
function obligations(task){return (Array.isArray(task?.taskContract?.obligations)?task.taskContract.obligations:[]).filter(item=>text(item?.id));}
function resultText(proposal={}){return text(proposal?.finalResult)||text(proposal?.summary)||text(proposal?.stageResult);}
function strings(values){return [...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];}
function confirmedClaims(certifiedContext={}){
  return (Array.isArray(certifiedContext?.claims)?certifiedContext.claims:[])
    .filter(claim=>claim?.level===ClaimLevel.CONFIRMED&&text(claim?.id)&&text(claim?.statement));
}
function unresolved(obligation,reason){
  return{
    id:`ASSESS:${text(obligation.id)}`,
    proofKind:'completion_obligation_support',
    certification:'unresolved',
    obligationRefs:[text(obligation.id)],
    criterionSatisfied:false,
    proofFactRefs:[],
    reason:text(reason)||'Completion proof is unresolved.',
  };
}
function accepted(obligation,claims,reason){
  return{
    id:`ASSESS:${text(obligation.id)}`,
    proofKind:'completion_obligation_support',
    certification:'supported',
    obligationRefs:[text(obligation.id)],
    criterionSatisfied:true,
    proofFactRefs:claims.map(claim=>text(claim.id)).filter(Boolean),
    reason:text(reason),
  };
}

/**
 * Deterministic completion ledger.
 * Root owns the judgment that a CONFIRMED Claim satisfies an obligation and must
 * state that relation explicitly through claim.obligationRefs. Validator has
 * already checked the Claim's source ledger; this component only checks the
 * declared ids/provenance and CompletionEvaluator aggregates the result.
 */
export class CompletionAssessmentVerifier{
  constructor(_options={}){}
  available(){return true;}

  async review({task,proposal,certifiedContext=null}={}){
    const assessments=[];
    const claims=confirmedClaims(certifiedContext||{});

    for(const obligation of obligations(task)){
      if(!supported(obligation)){
        assessments.push(unresolved(obligation,'Obligation is not Requirement-certified.'));
        continue;
      }
      const refs=obligation?.requirementRefs??obligation?.requirement_refs??[];
      const resolved=resolveRequirementRefs(task?.requirementSources??task?.requirement_sources??[],refs);
      if(!resolved.valid){
        assessments.push(unresolved(obligation,'Obligation Requirement provenance is invalid.'));
        continue;
      }
      if(!resultText(proposal)){
        assessments.push(unresolved(obligation,'Root completion proposal has no result.'));
        continue;
      }

      const mapped=claims.filter(claim=>strings(claim?.obligationRefs).includes(text(obligation.id)));
      if(!mapped.length){
        assessments.push(unresolved(obligation,'Root supplied no CONFIRMED Claim explicitly mapped to this obligation.'));
        continue;
      }

      assessments.push(accepted(
        obligation,
        mapped,
        `Root completion judgment cites CONFIRMED Claim(s): ${mapped.map(claim=>text(claim.id)).join(', ')}. Source provenance was already checked before completion aggregation.`,
      ));
    }

    return{checked:assessments.length>0,assessments};
  }
}
