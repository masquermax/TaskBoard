// Test-only Owner doubles for tests whose subject is NOT Completion semantics.
// They replace both CompletionAssessmentVerifier and CompletionEvaluator explicitly
// at the constructor boundary. Production Runtime never imports this helper and
// receives no compatibility fallback.
export function successfulCompletionDependenciesForControlFlowTest() {
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
  return { completionAssessmentVerifier, completionEvaluator };
}

export function installSuccessfulCompletionFixture(rootRuntime) {
  const dependencies = successfulCompletionDependenciesForControlFlowTest();
  rootRuntime.completionAssessmentVerifier = dependencies.completionAssessmentVerifier;
  rootRuntime.completionEvaluator = dependencies.completionEvaluator;
  return rootRuntime;
}
