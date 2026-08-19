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
  const completionAssessmentVerifier = {
    available() { return true; },
    async review() {
      return {
        checked: true,
        assessments: [{
          id: 'TEST-COMPLETION-ASSESSMENT',
          proofKind: 'completion_obligation_support',
          certification: 'supported',
          obligationRefs: ['TEST-OBLIGATION'],
          criterionSatisfied: true,
          proofFactRefs: ['TEST-CERTIFIED-FACT'],
        }],
      };
    },
  };
  const completionEvaluator = {
    evaluate() {
      return { goalState:'satisfied', satisfiedObligationIds:['TEST-OBLIGATION'], unsatisfiedObligationIds:[] };
    },
  };
  return { validatorRuntime, completionAssessmentVerifier, completionEvaluator };
}

export function installSuccessfulCompletionFixture(rootRuntime) {
  const dependencies = successfulCompletionDependenciesForControlFlowTest();
  rootRuntime.completionAssessmentVerifier = dependencies.completionAssessmentVerifier;
  rootRuntime.completionEvaluator = dependencies.completionEvaluator;
  return rootRuntime;
}
