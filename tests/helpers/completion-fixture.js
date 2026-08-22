import { ValidatorRuntime } from '../../src/governance/validator-runtime.js';

// Test-only Owner dependencies for tests whose subject is NOT Completion or
// Candidate source-ledger semantics. Production Runtime never imports this helper.
export function successfulCompletionDependenciesForControlFlowTest() {
  const validatorRuntime = new ValidatorRuntime({
    sourceTraceVerifier:{
      enforce({evidence=[]}){
        return{evidence,actions:[],verifications:evidence.map(item=>({id:item?.id||null,checked:true,verified:true,traceable:true}))};
      },
    },
  });
  const completionEvaluator = {
    evaluate() {
      return {
        goalState:'satisfied',
        satisfiedObligationIds:['TEST-OBLIGATION'],
        unsatisfiedObligationIds:[],
        assessments:[{id:'TEST-COMPLETION-ASSESSMENT',obligationRefs:['TEST-OBLIGATION'],criterionSatisfied:true,proofFactRefs:['TEST-CERTIFIED-FACT'],certification:'supported'}],
      };
    },
  };
  return { validatorRuntime, completionEvaluator };
}

export function installSuccessfulCompletionFixture(rootRuntime) {
  rootRuntime.completionEvaluator = successfulCompletionDependenciesForControlFlowTest().completionEvaluator;
  return rootRuntime;
}
