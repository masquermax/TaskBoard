export class ExecutorPort {
  readiness() { return { ready:true, preparing:false, reason:null, message:null }; }
  async health() { throw new Error('Not implemented'); }
  // Executor reports when the real Root/Subagent operation is actually admitted;
  // Scheduler uses that fact for READY -> RUNNING instead of guessing from intent.
  async runRoot(_request) { throw new Error('Not implemented'); }
  async runSubagent(_request) { throw new Error('Not implemented'); }
  cleanupTaskWorkspace(_taskId) { return false; }
  close() {}
}
