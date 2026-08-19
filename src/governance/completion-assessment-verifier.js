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
 * CompletionAssessmentVerifier is deterministic glue, not another reasoning role.
 * Root owns the judgment that a confirmed Claim satisfies a governed obligation;
 * Validator has already checked that Claim's source ledger. This component only
 * verifies the explicit mapping and hands it to CompletionEvaluator, which remains
 * the sole Goal Satisfaction aggregator.
 */
export class CompletionAssessmentVerifier{
  constructor(_options={}){}
  available(){return true;}

  async review({task,proposal,certifiedContext=null}={}){
    const assessments=[];
    const taskObligations=obligations(task);
    const supportedObligations=taskObligations.filter(supported);
    const claims=confirmedClaims(certifiedContext||{});

    for(const obligation of taskObligations){
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

      let mapped=claims.filter(claim=>strings(claim?.obligationRefs).includes(text(obligation.id)));
      // Compatibility for the current canonical TaskContract, which contains one
      // goal obligation. Until every Root output emits obligationRefs, a single
      // governed obligation may consume all CONFIRMED Task Claims. Multi-obligation
      // Tasks stay fail-closed without explicit Root mapping.
      if(!mapped.length&&supportedObligations.length===1)mapped=claims;

      if(!mapped.length){
        assessments.push(unresolved(obligation,'Root supplied no CONFIRMED Claim mapped to this obligation.'));
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
