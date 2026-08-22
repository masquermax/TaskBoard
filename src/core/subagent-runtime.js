import { failWorkUnitObservability, finalizeWorkUnitObservability } from './work-unit-observability.js';
import { scopeTaskInputs } from './task-input-scope.js';

function text(value){return String(value==null?'':value).trim();}

function blockedDependency(delegation){return (Array.isArray(delegation?.dependencyResults)?delegation.dependencyResults:[]).find(item=>text(item?.result?.blocker));}
function unmetDependencyResult(delegation,dependency){const dependencyId=text(dependency?.id)||'unknown';return{delegationId:text(delegation?.id),result:`前置 Work Unit ${dependencyId} 未满足工作契约；当前依赖 Work Unit 未执行。`,evidence:[],blocker:`WORK_UNIT_DEPENDENCY_UNSATISFIED: 前置 Work Unit ${dependencyId} 未满足工作契约。`};}

export class SubagentRuntime{
  constructor({executor,modelRouter}){this.executor=executor;this.modelRouter=modelRouter;}

  async run(task,delegation,{onProgress=null,onExecutionStarted=null,signal=null,policyContext=null}={}){
    const dependencyBlocker=blockedDependency(delegation);if(dependencyBlocker)return unmetDependencyResult(delegation,dependencyBlocker);
    const scopedTask=scopeTaskInputs(task,delegation?.inputRefs),diagnosticIdentity={taskId:scopedTask?.id||task?.id||null,workUnitId:delegation?.id||null};
    await this.modelRouter.prepare?.({role:'subagent',task:scopedTask,work:delegation});
    let raw;
    try{raw=await this.executor.runSubagent({task:scopedTask,delegation,modelPolicy:this.modelRouter.route({role:'subagent',task:scopedTask,work:delegation}),policyContext,onProgress,onExecutionStarted,signal});}
    catch(error){try{failWorkUnitObservability({...diagnosticIdentity,status:error?.interrupted?'interrupted':'failed',blocker:error?.message||String(error)});}catch{/* diagnostics only */}throw error;}

    const evidence=Array.isArray(raw?.evidence)?raw.evidence:[],blocker=text(raw?.blocker)||null;
    try{finalizeWorkUnitObservability({...diagnosticIdentity,evidence,status:'completed',blocker});}catch{/* diagnostics only */}
    return{delegationId:text(delegation?.id),result:text(raw?.result),evidence,blocker};
  }
}
