export class ExecutorPort {
  readiness() { return { ready:true, preparing:false, reason:null, message:null }; }
  async health() { throw new Error('Not implemented'); }
  // Execution adapters must call request.onExecutionStarted exactly when the\n  // real Root turn/resource has been accepted. Scheduler uses that fact as the\n  // READY -> RUNNING admission boundary; returning a terminal Root result\n  // without reporting the start is an adapter contract error.\n  async runRoot(_request) { throw new Error('Not implemented'); }
  async runSubagent(_request) { throw new Error('Not implemented'); }
  cleanupTaskWorkspace(_taskId) { return false; }
  close() {}
}
