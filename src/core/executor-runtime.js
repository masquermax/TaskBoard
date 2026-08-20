import { compileRootExecutorRequest, compileSubagentExecutorRequest } from './executor-contract.js';

/**
 * Internal TaskBoard adapter between role-aware Runtime and the public generic
 * ExecutorPort. Extension code receives only compiled execute(request) calls.
 */
export class ExecutorRuntimeAdapter {
  constructor(executor){
    if(!executor||typeof executor.execute!=='function')throw new Error('EXECUTOR_EXECUTE_REQUIRED');
    this.executor=executor;
  }

  readiness(){return this.executor.readiness?.()||{ready:true,preparing:false,reason:null,message:null};}
  health(){return this.executor.health?.()??Promise.resolve({available:true});}
  cleanupTaskWorkspace(taskId){return this.executor.cleanupTaskWorkspace?.(taskId)??false;}
  close(){return this.executor.close?.();}

  runRoot(request={}){
    return this.executor.execute(compileRootExecutorRequest(request));
  }

  runSubagent(request={}){
    const executorContext=this.executor.runtimeContext?.()??null;
    return this.executor.execute(compileSubagentExecutorRequest({...request,executorContext}));
  }
}
