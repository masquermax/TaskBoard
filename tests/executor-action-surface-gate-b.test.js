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

function turnRequest(role,type,{fileAccess='read',networkAccess=false}={}){
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
    diagnosticContext:{role},
  };
  return{client,request};
}

test('AppServerClient treats role as diagnostics, not command-execution authority',async()=>{
  for(const role of ['root','validator','subagent']){
    const {client,request}=turnRequest(role,'commandExecution');
    assert.equal(await client.runTurn(request),'{"ok":true}',role);
  }
});

test('AppServerClient fails closed when file-change events exceed the projected runtime profile',async()=>{
  const {client,request}=turnRequest('subagent','fileChange',{fileAccess:'read'});
  await assert.rejects(client.runTurn(request),error=>{
    assert.match(error.message,/EXECUTION_SURFACE_VIOLATION/);
    assert.equal(error.authorityViolation,true);
    return true;
  });
});

test('AppServerClient fails closed when web-search events exceed the projected runtime profile',async()=>{
  const {client,request}=turnRequest('subagent','webSearch',{networkAccess:false});
  await assert.rejects(client.runTurn(request),error=>{
    assert.match(error.message,/EXECUTION_SURFACE_VIOLATION/);
    assert.equal(error.authorityViolation,true);
    return true;
  });
});

test('AppServerClient keeps unsupported ambient action surfaces fail-closed',async()=>{
  for(const type of ['mcpToolCall','collabToolCall','dynamicToolCall']){
    const {client,request}=turnRequest('subagent',type,{fileAccess:'write',networkAccess:true});
    await assert.rejects(client.runTurn(request),/EXECUTION_SURFACE_VIOLATION/);
  }
});
