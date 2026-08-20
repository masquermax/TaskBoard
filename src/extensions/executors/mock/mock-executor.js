import { ExecutorPort } from '../../../core/executor-port.js';

function wait(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted){const e=new Error('Execution interrupted');e.interrupted=true;return reject(e);}const timer=setTimeout(resolve,ms);signal?.addEventListener?.('abort',()=>{clearTimeout(timer);const e=new Error('Execution interrupted');e.interrupted=true;reject(e);},{once:true});});}
function empty(){return{resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[]};}

/** Mock exercises TaskBoard control flow only; it owns no business evidence or extra role. */
export class MockExecutor extends ExecutorPort {
  async health(){return{executor:'mock',available:true,version:'built-in',error:null};}

  async runRoot({task,humanGatewayHistory,onProgress=null,onExecutionStarted=null,signal=null}){
    onExecutionStarted?.({mock:true});onProgress?.({summary:'Mock 正在执行 Root',detail:'用于验证 TaskBoard 控制链，不产生业务事实。'});await wait(80,signal);
    const resolved=(humanGatewayHistory||[]).filter(g=>g.status==='RESOLVED'),instruction=`${task.title} ${task.instruction}`,broad=/OA|系统.*做|做.*系统/i.test(instruction)&&instruction.length<120;
    if(broad&&!resolved.length)return{kind:'human_gateway',summary:'业务范围过大，需要一个人类拥有的范围选择。',finalResult:null,...empty(),gaps:[{id:'G-MOCK-SCOPE',question:'这个系统本次最核心需要覆盖哪些业务范围？',reason:'不同模块组合会直接改变结果。',kind:'business_decision',blocking:true,evidenceIds:[]}],gateway:{gapId:'G-MOCK-SCOPE',question:'这个系统本次最核心需要覆盖哪些业务范围？',context:'该选择由用户拥有。',options:['基础办公：组织、审批、公告、文档','人事办公：再加入考勤、请假、人事档案']},gapResolutions:[],delegations:[]};
    return{kind:'complete',summary:'Mock execution completed the TaskBoard control flow.',finalResult:`Mock 已完成执行链：${task.title}`,...empty(),gateway:null,gapResolutions:[],delegations:[]};
  }

  async runSubagent({delegation,onProgress=null,onExecutionStarted=null,signal=null}){
    onExecutionStarted?.({mock:true});onProgress?.({summary:'Mock 正在执行 Subagent Work Unit',detail:delegation.title||''});await wait(50,signal);
    return{delegationId:delegation.id,result:`Mock Subagent 完成执行链：${delegation.title}`,evidence:[],blocker:null};
  }
}
