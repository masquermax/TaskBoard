import { AnalysisResultValidator } from '../../src/governance/analysis-validator.js';
import { ValidatorRuntime } from '../../src/governance/validator-runtime.js';

// Test-only Owner dependencies for tests whose subject is NOT Completion or
// Candidate-certification semantics. Direct RootRuntime control-flow fixtures get
// a structural Validator owner plus successful Completion owners. Production
// Runtime never imports this helper and receives no compatibility fallback.
export function successfulCompletionDependenciesForControlFlowTest() {
  const validatorRuntime = new ValidatorRuntime({ analysisValidator:new AnalysisResultValidator() });
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
