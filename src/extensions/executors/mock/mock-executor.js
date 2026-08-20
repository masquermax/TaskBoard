import { ExecutorPort } from '../../../core/executor-port.js';

function wait(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted){const e=new Error('Execution interrupted');e.interrupted=true;return reject(e);}const timer=setTimeout(resolve,ms);signal?.addEventListener?.('abort',()=>{clearTimeout(timer);const e=new Error('Execution interrupted');e.interrupted=true;reject(e);},{once:true});});}
function empty(){return{resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[]};}
function isDecisionContract(contract){return Array.isArray(contract?.properties?.kind?.enum)&&contract.properties.kind.enum.includes('complete');}

/** Mock exercises the generic Executor contract only. */
export class MockExecutor extends ExecutorPort {
  async health(){return{executor:'mock',available:true,version:'built-in',error:null};}

  async execute(request={}){
    request.onExecutionStarted?.({mock:true});
    const rootLike=isDecisionContract(request.responseContract),context=request.context||{};
    request.onProgress?.({summary:rootLike?'Mock 正在执行决策请求':'Mock 正在执行工作请求',detail:'用于验证 TaskBoard 控制链，不拥有额外治理语义。'});
    await wait(rootLike?80:50,request.signal);
    if(rootLike){
      const task=context.task||{},resolved=context.resolvedHumanAnswers||[],instruction=`${task.title||''} ${task.instruction||''}`,broad=/OA|系统.*做|做.*系统/i.test(instruction)&&instruction.length<120;
      if(broad&&!resolved.length)return{kind:'human_gateway',summary:'业务范围过大，需要一个人类拥有的范围选择。',finalResult:null,...empty(),gaps:[{id:'G-MOCK-SCOPE',question:'这个系统本次最核心需要覆盖哪些业务范围？',reason:'不同模块组合会直接改变结果。',kind:'business_decision',blocking:true,evidenceIds:[]}],gateway:{gapId:'G-MOCK-SCOPE',question:'这个系统本次最核心需要覆盖哪些业务范围？',context:'该选择由用户拥有。',options:['基础办公：组织、审批、公告、文档','人事办公：再加入考勤、请假、人事档案']},gapResolutions:[],delegations:[]};
      return{kind:'complete',summary:'Mock execution completed the TaskBoard control flow.',finalResult:`Mock 已完成执行链：${task.title||''}`,...empty(),gateway:null,gapResolutions:[],delegations:[]};
    }
    const work=context.workUnit||{};
    return{delegationId:work.id||request.runtime?.workUnitId||'',result:`Mock Subagent 完成执行链：${work.title||''}`,evidence:[],blocker:null};
  }
}
