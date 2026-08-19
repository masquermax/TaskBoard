export class ExecutorPort {
  readiness() { return { ready:true, preparing:false, reason:null, message:null }; }
  async health() { throw new Error('Not implemented'); }
  // Executor must call request.onExecutionStarted exactly when the real Root
  // turn/resource has been accepted. Scheduler uses that fact as the
  // READY -> RUNNING admission boundary; a terminal Root result without a
  // reported start is an Executor contract error.
  async runRoot(_request) { throw new Error('Not implemented'); }
  async runSubagent(_request) { throw new Error('Not implemented'); }
  // Observability only. Implementations may aggregate transport/tool facts after
  // TaskBoard has verified the Work Unit evidence. This hook creates no Evidence,
  // Completion or Authority semantics and must never affect task execution.
  finalizeWorkUnitDiagnostics(_request) {}
  // runValidator is an optional Executor capability. It is intentionally not a
  // base method: SemanticProofVerifier detects method presence so a Mock or
  // limited Executor cannot accidentally advertise semantic proof capability.
  cleanupTaskWorkspace(_taskId) { return false; }
  close() {}
}
