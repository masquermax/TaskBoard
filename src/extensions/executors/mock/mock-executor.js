import { ExecutorPort } from '../../../core/executor-port.js';

function wait(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted){const e=new Error('Execution interrupted');e.interrupted=true;return reject(e);}const timer=setTimeout(resolve,ms);signal?.addEventListener?.('abort',()=>{clearTimeout(timer);const e=new Error('Execution interrupted');e.interrupted=true;reject(e);},{once:true});});}

function mockValue(schema={}){
  if(Array.isArray(schema?.enum)&&schema.enum.length)return schema.enum[0];
  if(Array.isArray(schema?.type)){
    if(schema.type.includes('null'))return null;
    return mockValue({...schema,type:schema.type[0]});
  }
  if(schema?.anyOf){const nullable=schema.anyOf.find(item=>item?.type==='null');if(nullable)return null;return mockValue(schema.anyOf[0]||{});}
  if(schema?.type==='array')return[];
  if(schema?.type==='boolean')return false;
  if(schema?.type==='number'||schema?.type==='integer')return 0;
  if(schema?.type==='object'||schema?.properties){const out={};for(const key of schema.required||[])out[key]=mockValue(schema.properties?.[key]||{});return out;}
  return'';
}

/** Mock exercises only the generic Executor transport contract. */
export class MockExecutor extends ExecutorPort {
  async health(){return{executor:'mock',available:true,version:'built-in',error:null};}

  async execute(request={}){
    request.onExecutionStarted?.({mock:true});
    request.onProgress?.({summary:'Mock 正在执行请求',detail:'用于验证通用 Executor Contract，不拥有 TaskBoard 业务或治理语义。'});
    await wait(20,request.signal);
    return mockValue(request.responseContract||{});
  }
}
