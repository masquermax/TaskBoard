import { compileRootExecutorRequest, compileSubagentExecutorRequest } from './executor-contract.js';

export class ExecutorPort {
  readiness() { return { ready:true, preparing:false, reason:null, message:null }; }
  async health() { throw new Error('Not implemented'); }

  // Extension contract: executors receive one already-compiled request and only
  // realize provider/runtime transport. TaskBoard semantics stay in Core.
  async execute(_request) { throw new Error('Not implemented'); }

  // Core-only role adapters. Extensions do not override these and therefore do
  // not own Root/Subagent instructions, context shaping, response schemas, or
  // governance semantics.
  async runRoot(request = {}) {
    return this.execute(compileRootExecutorRequest(request));
  }
  async runSubagent(request = {}) {
    return this.execute(compileSubagentExecutorRequest({...request,executorContext:this.runtimeContext()}));
  }

  // Optional raw technical facts; Core decides whether/how they enter context.
  runtimeContext() { return null; }
  cleanupTaskWorkspace(_taskId) { return false; }
  close() {}
}
