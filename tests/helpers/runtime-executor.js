import { ExecutorRuntimeAdapter } from '../../src/core/executor-runtime.js';

/** Test-only bridge: production bootstrap owns this adaptation. */
export function asRuntimeExecutor(executor){
  if(typeof executor?.runRoot==='function'&&typeof executor?.runSubagent==='function')return executor;
  return new ExecutorRuntimeAdapter(executor);
}
