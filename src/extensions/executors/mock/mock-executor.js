import { ExecutorPort } from '../../../core/executor-port.js';

function wait(ms, signal){return new Promise((resolve,reject)=>{if(signal?.aborted){const e=new Error('Execution interrupted');e.interrupted=true;return reject(e);}const timer=setTimeout(resolve,ms);signal?.addEventListener?.('abort',()=>{clearTimeout(timer);const e=new Error('Execution interrupted');e.interrupted=true;reject(e);},{once:true});});}
function empty(mode='execution'){return{resultMode:mode,evidence:[],claims:[],gaps:[],recommendations:[],steps:[]};}

export class MockExecutor extends ExecutorPort {
  async health(){return{executor:'mock',available:true,version:'built-in',error:null};}
  async runRoot({task,humanGatewayHistory,onProgress=null,onExecutionStarted=null,signal=null,policyContext=null}){
    onExecutionStarted?.({mock:true});onProgress?.({summary:'Mock 正在执行 Root 阶段',detail:'用于验证 TaskBoard 执行链，不产生业务事实。'});await wait(80,signal);
    const resolved=(humanGatewayHistory||[]).filter(g=>g.status==='RESOLVED');const instruction=`${task.title} ${task.instruction}`;const broad=/OA|系统.*做|做.*系统/i.test(instruction)&&instruction.length<120;
    if(broad&&!resolved.length)return{kind:'human_gateway',summary:'业务范围过大，继续猜测会显著改变结果。',stageResult:'已确认任务方向，但核心业务范围尚未确定。',finalResult:null,...empty(policyContext?.taskMode==='analysis'?'analysis':'execution'),gaps:[{id:'G-MOCK-SCOPE',question:'这个系统本次最核心需要覆盖哪些业务范围？',reason:'不同模块组合会直接改变数据模型、权限和流程设计。',kind:'business_decision',blocking:true,evidenceIds:[]}],gateway:{gapId:'G-MOCK-SCOPE',question:'这个系统本次最核心需要覆盖哪些业务范围？',context:'不同模块组合会直接改变数据模型、权限和流程设计，因此这里不继续盲猜。',options:['基础办公：组织、审批、公告、文档','人事办公：再加入考勤、请假、人事档案']},delegations:[]};
    const mode=policyContext?.taskMode==='analysis'?'analysis':'execution';
    return{kind:'complete',summary:'Mock execution completed the TaskBoard control flow.',stageResult:'Mock 仅验证执行链，不产生业务事实。',finalResult:mode==='execution'?`Mock 已完成执行链：${task.title}`:null,...empty(mode),gateway:null,delegations:[]};
  }
  async runSubagent({delegation,onProgress=null,onExecutionStarted=null,signal=null}){onExecutionStarted?.({mock:true});onProgress?.({summary:'Mock 正在执行 Subagent Work Unit',detail:delegation.title||''});await wait(50,signal);return{delegationId:delegation.id,result:`Mock Subagent 完成执行链：${delegation.title}`,evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};}
  async runValidator({candidates,onProgress=null,onExecutionStarted=null,signal=null}){
    onExecutionStarted?.({mock:true});onProgress?.({summary:'Mock Validator 正在认证',detail:'用于验证 TaskBoard semantic-proof 调用链。'});await wait(20,signal);
    return{reviews:(Array.isArray(candidates)?candidates:[]).map(candidate=>({id:candidate.id,verdict:'supported',reason:'Mock Validator accepts the synthetic proof candidate for control-flow verification.'}))};
  }
}
