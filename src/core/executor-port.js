export class ExecutorPort {
  readiness() { return { ready:true, preparing:false, reason:null, message:null }; }
  async health() { throw new Error('Not implemented'); }

  // Public Extension contract. TaskBoard Core compiles role semantics, context,
  // response contract, authority and model policy before this boundary.
  async execute(_request) { throw new Error('Not implemented'); }

  // Optional raw technical facts; Core decides whether/how they enter context.
  runtimeContext() { return null; }
  cleanupTaskWorkspace(_taskId) { return false; }
  close() {}
}
