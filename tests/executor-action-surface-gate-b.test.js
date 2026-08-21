import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexAppServerClient } from '../src/extensions/executors/codex/app-server-client.js';

class EventClient extends CodexAppServerClient {
  constructor(type){super({command:'unused',turnEventTimeoutMs:1_000});this.type=type;this.turnSeq=0;}
  async connect(){}
  async request(method,params={}){
    if(method==='thread/start')return{
      thread:{id:'thr_surface',ephemeral:true},
      activePermissionProfile:{id:params.permissions},
      runtimeWorkspaceRoots:params.runtimeWorkspaceRoots||[],
    };
    if(method==='turn/start'){
      const turnId=`turn_${++this.turnSeq}`;
      queueMicrotask(()=>{
        this.emitNotification({method:'item/started',params:{threadId:params.threadId,turnId,item:{id:'action',type:this.type}}});
        this.emitNotification({method:'item/completed',params:{threadId:params.threadId,turnId,item:{id:'message',type:'agentMessage',text:'{"ok":true}'}}});
        this.emitNotification({method:'turn/completed',params:{threadId:params.threadId,turn:{id:turnId,status:'completed',items:[],error:null}}});
      });
      return{turn:{id:turnId,status:'inProgress',items:[]}};
    }
    if(method==='turn/interrupt')return{};
    throw new Error(`Unexpected request ${method}`);
  }
}

function turnRequest(type,{fileAccess='read',networkAccess=false,workUnitId=null}={}){
  const client=new EventClient(type);
  const request={
    cwd:'scratch',
    writableRoots:[],
    prompt:'test',
    inputItems:[],
    outputSchema:{type:'object'},
    permissionProfile:'taskboard_runtime',
    runtimeWorkspaceRoots:['scratch'],
    runtimeConfig:{permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':fileAccess}},network:{enabled:networkAccess}}}},
    diagnosticContext:{taskId:'T-surface',workUnitId},
  };
  return{client,request};
}

test('AppServerClient treats Work Unit identity as diagnostics, not command-execution authority',async()=>{
  for(const workUnitId of [null,'WU-1']){
    const {client,request}=turnRequest('commandExecution',{workUnitId});
    assert.equal(await client.runTurn(request),'{"ok":true}',workUnitId||'task');
  }
});

test('AppServerClient fails closed when file-change events exceed the projected runtime profile',async()=>{
  const {client,request}=turnRequest('fileChange',{fileAccess:'read',workUnitId:'WU-1'});
  await assert.rejects(client.runTurn(request),error=>{
    assert.match(error.message,/EXECUTION_SURFACE_VIOLATION/);
    assert.equal(error.authorityViolation,true);
    return true;
  });
});

test('AppServerClient fails closed when web-search events exceed the projected runtime profile',async()=>{
  const {client,request}=turnRequest('webSearch',{networkAccess:false,workUnitId:'WU-1'});
  await assert.rejects(client.runTurn(request),error=>{
    assert.match(error.message,/EXECUTION_SURFACE_VIOLATION/);
    assert.equal(error.authorityViolation,true);
    return true;
  });
});

test('AppServerClient keeps unsupported ambient action surfaces fail-closed',async()=>{
  for(const type of ['mcpToolCall','collabToolCall','dynamicToolCall']){
    const {client,request}=turnRequest(type,{fileAccess:'write',networkAccess:true,workUnitId:'WU-1'});
    await assert.rejects(client.runTurn(request),/EXECUTION_SURFACE_VIOLATION/);
  }
});
