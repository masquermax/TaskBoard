import { CompletionEvaluator } from '../../src/governance/completion-evaluator.js';

// Test-only Owner double for tests whose subject is NOT Completion semantics.
// It replaces CompletionAssessmentVerifier explicitly at the constructor boundary;
// production Runtime never imports this helper and receives no compatibility fallback.
export function successfulCompletionDependenciesForControlFlowTest() {
  const completionAssessmentVerifier = {
    available() { return true; },
    async review({ task }) {
      const obligations = Array.isArray(task?.taskContract?.obligations) ? task.taskContract.obligations : [];
      return {
        checked: true,
        assessments: obligations.map((obligation, index) => ({
          id: `TEST-COMPLETION-ASSESSMENT-${index + 1}`,
          proofKind: 'completion_obligation_support',
          certification: 'supported',
          obligationRefs: [String(obligation.id)],
          criterionSatisfied: true,
          proofFactRefs: [`TEST-CERTIFIED-FACT-${index + 1}`],
        })),
      };
    },
  };
  return { completionAssessmentVerifier, completionEvaluator: new CompletionEvaluator() };
}

export function installSuccessfulCompletionFixture(rootRuntime) {
  const dependencies = successfulCompletionDependenciesForControlFlowTest();
  rootRuntime.completionAssessmentVerifier = dependencies.completionAssessmentVerifier;
  rootRuntime.completionEvaluator = dependencies.completionEvaluator;
  return rootRuntime;
}
