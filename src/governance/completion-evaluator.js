import { ClaimLevel } from './analysis-contract.js';
import { resolveRequirementRefs } from './task-contract-fidelity.js';

export const GoalState=Object.freeze({SATISFIED:'satisfied',UNSATISFIED:'unsatisfied'});
const text=value=>String(value??'').trim();
const list=value=>Array.isArray(value)?value:[];
const strings=values=>[...new Set(list(values).map(text).filter(Boolean))];
const supported=value=>value?.certification==='supported';
const resultText=proposal=>text(proposal?.finalResult)||text(proposal?.summary);

function obligations(task){return list(task?.taskContract?.obligations).filter(item=>text(item?.id));}
function confirmedClaims(certifiedContext){return list(certifiedContext?.claims).filter(claim=>claim?.level===ClaimLevel.CONFIRMED&&text(claim?.id)&&text(claim?.statement));}
function assessment(obligation,{satisfied=false,claimIds=[],reason=''}){
  return{id:`ASSESS:${text(obligation?.id)}`,obligationRefs:[text(obligation?.id)],criterionSatisfied:satisfied,proofFactRefs:[...claimIds],certification:satisfied?'supported':'unresolved',reason:text(reason)};
}

/**
 * Completion is a deterministic projection of Root-owned judgment.
 * Root explicitly maps CONFIRMED Claims to obligation ids. Validator has already
 * checked those Claims' source ledger. This evaluator only checks that the
 * governed obligation/provenance exists and that Root supplied such a mapping.
 */
export class CompletionEvaluator{
  evaluate({task=null,proposal=null,certifiedContext=null}={}){
    const governed=obligations(task),claims=confirmedClaims(certifiedContext),hasResult=Boolean(resultText(proposal));
    const satisfiedObligationIds=[],unsatisfiedObligationIds=[],assessments=[];

    for(const obligation of governed){
      const id=text(obligation.id),refs=obligation?.requirementRefs??obligation?.requirement_refs??[];
      const requirement=resolveRequirementRefs(task?.requirementSources??task?.requirement_sources??[],refs);
      let mapped=[];let reason='';
      if(!supported(obligation))reason='Obligation is not Requirement-certified.';
      else if(!requirement.valid)reason='Obligation Requirement provenance is invalid.';
      else if(!hasResult)reason='Root completion proposal has no result.';
      else{
        mapped=claims.filter(claim=>strings(claim?.obligationRefs).includes(id));
        if(!mapped.length)reason='Root supplied no CONFIRMED Claim explicitly mapped to this obligation.';
      }
      const ok=!reason;
      (ok?satisfiedObligationIds:unsatisfiedObligationIds).push(id);
      assessments.push(assessment(obligation,{satisfied:ok,claimIds:mapped.map(claim=>text(claim.id)),reason:ok?`Root mapped CONFIRMED Claim(s): ${mapped.map(claim=>text(claim.id)).join(', ')}.`:reason}));
    }

    const goalState=governed.length>0&&unsatisfiedObligationIds.length===0?GoalState.SATISFIED:GoalState.UNSATISFIED;
    return{goalState,satisfiedObligationIds,unsatisfiedObligationIds,assessments};
  }
}
