import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { APP_VERSION } from '../../../version.js';
import { WorkUnitObservability, registerWorkUnitObservability, failWorkUnitObservability } from '../../../core/work-unit-observability.js';
import { CodexRuntimeResolver } from './codex-runtime-resolver.js';

const DIAGNOSTIC_RPC_METHODS=new Set(['initialize','model/list','account/read','config/read','modelProvider/capabilities/read','thread/start','turn/start']);
const LOG_LEVELS=Object.freeze({error:0,warn:1,info:2,debug:3,trace:4});
function normalizeLogLevel(value){const level=String(value||'info').trim().toLowerCase();return Object.prototype.hasOwnProperty.call(LOG_LEVELS,level)?level:'info';}

function childOptions(extra={}){return{...extra,env:extra.env??process.env,windowsHide:true,shell:process.platform==='win32'};}
function normalizedLaunchProfile(provider){let value={};try{value=typeof provider==='function'?(provider()||{}):{};}catch{value={};}return{mode:String(value.mode||'account'),providerId:value.providerId==null?null:String(value.providerId),args:Array.isArray(value.args)?value.args.map(String):[],env:value.env&&typeof value.env==='object'?value.env:{}};}

export class CodexAppServerClient{
  constructor({command=process.env.CODEX_COMMAND||process.env.TASKBOARD_CODEX_COMMAND||null,runtimeResolver=null,diagnosticLogger=null,logLevel=process.env.TASKBOARD_LOG_LEVEL||'info',turnEventTimeoutMs=30*60*1000,launchProfileProvider=null}={}){
    this.runtimeResolver=runtimeResolver||new CodexRuntimeResolver({env:process.env});
    if(command)this.runtimeResolver.env={...this.runtimeResolver.env,CODEX_COMMAND:command};
    this.command=command||null;this.child=null;this.nextId=1;this.pending=new Map();this.notificationWaiters=[];this.recentNotifications=[];this.initialized=false;this.version=null;this.connectPromise=null;this.connectionGeneration=0;this.generationListeners=new Set();this.diagnosticLogger=diagnosticLogger||(line=>console.error(line));this.logLevel=normalizeLogLevel(logLevel);this.activeTurnCount=0;this.turnEventTimeoutMs=Math.max(1_000,Number(turnEventTimeoutMs)||30*60*1000);this.launchProfileProvider=launchProfileProvider;
  }

  recordDiagnostic(event,data={},level='info'){const normalized=normalizeLogLevel(level);if(LOG_LEVELS[normalized]>LOG_LEVELS[this.logLevel])return;try{this.diagnosticLogger?.(`[codex-runtime] ${JSON.stringify({ts:new Date().toISOString(),level:normalized,event,...data})}`);}catch{/* diagnostics only */}}
  activeRpcMethods(){return[...this.pending.values()].map(item=>item?.method).filter(Boolean);}
  static probe(command=process.env.CODEX_COMMAND||'codex'){const result=spawnSync(command,['--version'],childOptions({encoding:'utf8',timeout:8_000})),output=(result.stdout||result.stderr||'').trim();return{available:result.status===0,version:result.status===0?output:null,error:result.status===0?null:(result.error?.message||output||'Codex command unavailable')};}

  async connect(){if(this.child&&this.initialized)return;if(this.connectPromise)return this.connectPromise;this.connectPromise=this.openConnection();try{await this.connectPromise;}finally{this.connectPromise=null;}}
  runtimeStatus(){return this.runtimeResolver?.status?.()||{state:this.command?'ready':'missing',available:Boolean(this.command),command:this.command,version:this.version||null,error:null};}
  scanRuntime(){const current=this.runtimeStatus();if(current.preparing||current.available)return current;return this.runtimeResolver?.resolveInstalled?.()||current;}
  prepareRuntime(){return this.runtimeResolver?.prepare?.()||Promise.resolve({available:Boolean(this.command),command:this.command,version:this.version||null,error:this.command?null:'Codex command unavailable'});}
  startRuntimePreparation(){return this.runtimeResolver?.startPrepare?.()||this.runtimeStatus();}
  async probeRuntime({prepare=true}={}){const status=prepare?await this.prepareRuntime():this.runtimeStatus();if(status?.available&&status.command){this.command=status.command;this.version=status.version||this.version||null;return{available:true,version:this.version,error:null,runtime:status};}return{available:false,version:status?.version||null,error:status?.error||'Codex command unavailable',runtime:status};}

  async openConnection(){
    const runtime=await this.runtimeResolver.requireReady();this.command=runtime.command;this.version=runtime.version||null;
    const launchProfile=normalizedLaunchProfile(this.launchProfileProvider),launchArgs=[...launchProfile.args,'app-server','--listen','stdio://'],launchEnv={...process.env,...launchProfile.env};
    this.recordDiagnostic('app-server-spawn',{command:this.command,version:this.version||null,nextGeneration:this.connectionGeneration+1,connectionMode:launchProfile.mode,providerId:launchProfile.providerId});
    this.child=spawn(this.command,launchArgs,childOptions({stdio:['pipe','pipe','pipe'],env:launchEnv}));
    this.recordDiagnostic('app-server-spawned',{pid:this.child.pid||null,command:this.command,version:this.version||null,connectionMode:launchProfile.mode,providerId:launchProfile.providerId});
    this.child.on('error',error=>this.failAll(error));
    this.child.stderr.on('data',chunk=>{const value=chunk.toString().trim();if(!value)return;console.error('[codex]',value);if(/failed to refresh available models|timeout waiting for child process to exit/i.test(value))this.recordDiagnostic('model-refresh-error',{pid:this.child?.pid||null,generation:this.connectionGeneration,activeRpcMethods:this.activeRpcMethods(),message:value.slice(0,1000)},'warn');});
    this.child.on('exit',code=>{this.recordDiagnostic('app-server-exit',{pid:this.child?.pid||null,generation:this.connectionGeneration,code:code??null},code===0?'info':'warn');const error=new Error(`Codex app-server exited (${code??'unknown'})`);this.failAll(error);this.initialized=false;this.child=null;});
    const rl=readline.createInterface({input:this.child.stdout});rl.on('line',line=>this.handleLine(line));
    await this.request('initialize',{clientInfo:{name:'taskboard_local',title:'TaskBoard Local',version:APP_VERSION},capabilities:{experimentalApi:true,optOutNotificationMethods:['item/agentMessage/delta']}},12_000);
    this.notify('initialized',{});this.initialized=true;this.connectionGeneration+=1;this.recordDiagnostic('app-server-ready',{pid:this.child.pid||null,generation:this.connectionGeneration,version:this.version||null,connectionMode:launchProfile.mode,providerId:launchProfile.providerId});
    for(const listener of [...this.generationListeners])try{listener(this.connectionGeneration);}catch{/* ignore */}
  }

  onConnectionGeneration(listener){if(typeof listener!=='function')return()=>{};this.generationListeners.add(listener);return()=>this.generationListeners.delete(listener);}
  failAll(error){for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();for(const waiter of this.notificationWaiters.splice(0))waiter.reject(error);}

  handleLine(line){
    let msg;try{msg=JSON.parse(line);}catch{return;}
    if(msg.id!=null&&!msg.method){const pending=this.pending.get(msg.id);if(!pending)return;clearTimeout(pending.timer);this.pending.delete(msg.id);if(DIAGNOSTIC_RPC_METHODS.has(pending.method))this.recordDiagnostic('rpc-end',{method:pending.method,id:msg.id,generation:this.connectionGeneration,durationMs:Date.now()-pending.startedAt,ok:!msg.error},'debug');if(msg.error){const error=new Error(msg.error.message||JSON.stringify(msg.error));error.rpcCode=msg.error.code;if([-32600,-32601,-32602].includes(msg.error.code)||/Invalid request|Invalid params|unknown variant|unknown field/i.test(error.message))error.nonRetryable=true;pending.reject(error);}else pending.resolve(msg.result);return;}
    if(msg.id!=null&&msg.method){if(msg.method==='item/permissions/requestApproval')this.respond(msg.id,{permissions:{}});else if(msg.method.includes('requestApproval'))this.respond(msg.id,{decision:'decline'});else if(msg.method==='mcpServer/elicitation/request')this.respond(msg.id,{action:'decline',content:null});else this.respondError(msg.id,-32601,'Unsupported client-side request');this.emitNotification({method:msg.method,params:msg.params,serverRequestDenied:true});return;}
    if(msg.method)this.emitNotification(msg);
  }

  emitNotification(msg){const waiter=this.notificationWaiters.find(item=>item.predicate(msg));if(waiter){this.notificationWaiters.splice(this.notificationWaiters.indexOf(waiter),1);waiter.resolve(msg);return;}this.recentNotifications.push(msg);if(this.recentNotifications.length>200)this.recentNotifications.shift();}
  waitFor(predicate,timeoutMs=30*60*1000){const existingIndex=this.recentNotifications.findIndex(predicate);if(existingIndex>=0){const[existing]=this.recentNotifications.splice(existingIndex,1);return Promise.resolve(existing);}return new Promise((resolve,reject)=>{let settled=false,timer=null;const finish=(fn,value)=>{if(settled)return;settled=true;if(timer)clearTimeout(timer);const idx=this.notificationWaiters.indexOf(waiter);if(idx>=0)this.notificationWaiters.splice(idx,1);fn(value);};const waiter={predicate,resolve:value=>finish(resolve,value),reject:error=>finish(reject,error)};this.notificationWaiters.push(waiter);timer=setTimeout(()=>waiter.reject(new Error('Timed out waiting for Codex event')),timeoutMs);timer?.unref?.();});}
  request(method,params={},timeoutMs=30_000){if(!this.child?.stdin)return Promise.reject(new Error('Codex app-server is not connected'));const id=this.nextId++,startedAt=Date.now();if(DIAGNOSTIC_RPC_METHODS.has(method))this.recordDiagnostic('rpc-start',{method,id,generation:this.connectionGeneration,pid:this.child?.pid||null},'debug');return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);if(DIAGNOSTIC_RPC_METHODS.has(method))this.recordDiagnostic('rpc-timeout',{method,id,generation:this.connectionGeneration,pid:this.child?.pid||null,durationMs:Date.now()-startedAt,timeoutMs},'warn');reject(new Error(`Timed out calling Codex ${method}`));},timeoutMs);this.pending.set(id,{resolve,reject,timer,method,startedAt});this.child.stdin.write(JSON.stringify({method,id,params})+'\n');});}
  notify(method,params={}){this.child?.stdin?.write(JSON.stringify({method,params})+'\n');}
  respond(id,result){this.child?.stdin?.write(JSON.stringify({id,result})+'\n');}
  respondError(id,code,message){this.child?.stdin?.write(JSON.stringify({id,error:{code,message}})+'\n');}

  async health(){
    const runtimeNow=this.scanRuntime();
    if(!runtimeNow.available&&!this.initialized){this.startRuntimePreparation();const current=this.runtimeStatus();return{available:false,preparing:Boolean(current.preparing),runtimeState:current.state,runtimeSource:current.source||null,version:current.version||null,connected:false,authenticated:false,error:current.preparing?null:(current.error||'Codex runtime unavailable')};}
    const probe=await this.probeRuntime({prepare:true});if(!probe.available)return{...probe,connected:false,authenticated:false};
    try{await this.connect();const account=await this.request('account/read',{refreshToken:false},8_000),authenticated=account?.requiresOpenaiAuth===false||Boolean(account?.account);return{available:true,connected:true,authenticated,version:probe.version,runtimeState:probe.runtime?.state||'ready',runtimeSource:probe.runtime?.source||null,authMode:account?.account?.type||null,planType:account?.account?.planType||null,error:authenticated?null:'Codex is connected but no account is authenticated'};}catch(error){return{available:true,connected:false,authenticated:false,version:probe.version,runtimeState:probe.runtime?.state||'ready',runtimeSource:probe.runtime?.source||null,authMode:null,planType:null,error:error.message||String(error)};}
  }

  validateExecutionGrant({permissionProfile,runtimeWorkspaceRoots}){const profile=String(permissionProfile||'').trim(),roots=[...new Set((Array.isArray(runtimeWorkspaceRoots)?runtimeWorkspaceRoots:[]).map(value=>String(value||'').trim()).filter(Boolean))];if(!profile||!roots.length){const error=new Error('CODEX_EXECUTION_GRANT_REQUIRED: permissionProfile and runtimeWorkspaceRoots are mandatory.');error.nonRetryable=true;throw error;}return{profile,roots};}
  sameRuntimeRoots(expected,actual){const norm=value=>{const valueText=String(value||'').replace(/\\/g,'/').replace(/\/$/,'');return process.platform==='win32'?valueText.toLowerCase():valueText;},left=[...new Set((expected||[]).map(norm))].sort(),right=[...new Set((actual||[]).map(norm))].sort();return left.length===right.length&&left.every((value,index)=>value===right[index]);}

  async runTurn({cwd,writableRoots=[],prompt,inputItems=[],outputSchema,model=null,reasoningEffort=null,networkAccess=false,permissionProfile=null,runtimeWorkspaceRoots=[],environments=null,runtimeConfig=null,onProgress=null,onExecutionStarted=null,signal=null,diagnosticContext=null}){
    const role=diagnosticContext?.role||'root',roleLabel=role==='subagent'?'Subagent':'Root',runningDetail=role==='subagent'?'模型正在执行当前 Work Unit。':'模型正在进行 Task 级判断。',formedDetail=role==='subagent'?'正在等待当前 Work Unit 完成并交回 Root。':'正在等待本轮 Root 判断完成。',completedDetail=role==='subagent'?'Work Unit 结果已交回 Root。':'Root 本轮判断已完成。',commandDetail=role==='subagent'?'正在检查当前 Work Unit 授权输入中的证据。':'正在处理 TaskBoard 临时工作区中的本轮判断材料。',fileChangeDetail=role==='subagent'?'正在修改当前 Work Unit 明确授权的文件范围。':'正在处理 TaskBoard 临时工作区文件。';
    if(signal?.aborted){const error=new Error('Execution interrupted');error.interrupted=true;throw error;}
    const executionStartedAt=Date.now(),routeMeta={taskId:diagnosticContext?.taskId||null,workUnitId:diagnosticContext?.workUnitId||null,role:diagnosticContext?.role||null,routeReason:diagnosticContext?.routeReason||null,requestedModel:model||null,configuredDefaultModel:diagnosticContext?.configuredDefaultModel||null,reasoningEffort:reasoningEffort||null,inputBytes:Buffer.byteLength(String(prompt||''),'utf8')};
    const executionGrant=this.validateExecutionGrant({permissionProfile,runtimeWorkspaceRoots}),runtimeProfile=runtimeConfig?.permissions?.[executionGrant.profile]||null,executionSurface={commandExecution:true,fileChange:runtimeProfile?.filesystem?.[':workspace_roots']?.['.']==='write',webSearch:runtimeProfile?.network?.enabled===true};
    this.recordDiagnostic('turn-route',{...routeMeta,permissionProfile:executionGrant.profile,runtimeWorkspaceRootCount:executionGrant.roots.length});await this.connect();onProgress?.({summary:'Codex 已连接',detail:'正在建立本轮执行上下文。'});

    const thread=await this.request('thread/start',{cwd,ephemeral:true,approvalPolicy:'never',personality:'pragmatic',permissions:executionGrant.profile,runtimeWorkspaceRoots:executionGrant.roots,...(Array.isArray(environments)?{environments}:{}),...(runtimeConfig&&typeof runtimeConfig==='object'?{config:runtimeConfig}:{}),...(model?{model}:{})});
    const activePermissionProfile=thread?.activePermissionProfile?.id||null;if(activePermissionProfile!==executionGrant.profile){const error=new Error(`CODEX_PERMISSION_PROFILE_NOT_APPLIED: requested ${executionGrant.profile}, got ${activePermissionProfile||'none'}`);error.nonRetryable=true;throw error;}
    if(!this.sameRuntimeRoots(executionGrant.roots,thread?.runtimeWorkspaceRoots||[])){this.recordDiagnostic('runtime-roots-mismatch',{...routeMeta,requestedPermissionProfile:executionGrant.profile,activePermissionProfile,requestedRuntimeWorkspaceRoots:executionGrant.roots,returnedRuntimeWorkspaceRoots:thread?.runtimeWorkspaceRoots??null,cwd,command:this.command||null,version:this.version||null},'error');const error=new Error('CODEX_RUNTIME_ROOTS_NOT_APPLIED: app-server did not confirm the exact Runtime workspace roots.');error.nonRetryable=true;throw error;}
    const threadId=thread.thread.id,resolvedThreadModel=thread?.thread?.model||thread?.thread?.modelId||null;onProgress?.({summary:'Codex 会话已建立',detail:`正在启动本轮 ${roleLabel} 执行。`});
    const start=await this.request('turn/start',{threadId,input:[{type:'text',text:prompt},...inputItems],approvalPolicy:'never',outputSchema,...(model?{model}:{}),...(reasoningEffort?{effort:reasoningEffort}:{})}),turnId=start.turn.id,resolvedTurnModel=start?.turn?.model||start?.turn?.modelId||resolvedThreadModel||null;
    this.activeTurnCount+=1;const activeAtStart=this.activeTurnCount;this.recordDiagnostic('turn-started',{...routeMeta,threadId,turnId,resolvedModel:resolvedTurnModel||null,activeTurnCount:activeAtStart});
    const workUnitObserver=role==='subagent'?registerWorkUnitObservability(new WorkUnitObservability({taskId:routeMeta.taskId,workUnitId:routeMeta.workUnitId,turnId,startedAt:Date.now(),emitDiagnostic:(event,data,level)=>this.recordDiagnostic(event,data,level)})):null;
    let interruptRequested=false;const interrupt=()=>{if(interruptRequested)return;interruptRequested=true;this.request('turn/interrupt',{threadId,turnId},8_000).catch(error=>console.error('[codex interrupt]',error.message||error));};
    signal?.addEventListener?.('abort',interrupt,{once:true});if(signal?.aborted)interrupt();
    const agentMessages=[];let toolCallCount=0,completed=null;
    try{
      onExecutionStarted?.({threadId,turnId,requestedModel:model||null,resolvedModel:resolvedTurnModel,reasoningEffort:reasoningEffort||null});onProgress?.({summary:'Codex 正在执行',detail:runningDetail});
      while(!completed){
        const event=await this.waitFor(msg=>{if(msg.method==='item/started'||msg.method==='item/completed')return msg.params?.threadId===threadId&&msg.params?.turnId===turnId;return msg.method==='turn/completed'&&msg.params?.turn?.id===turnId;},this.turnEventTimeoutMs);
        if(event.method==='item/started'){
          const item=event.params?.item,type=String(item?.type||''),forbiddenAmbient=new Set(['mcpToolCall','collabToolCall','dynamicToolCall']),actionViolation=forbiddenAmbient.has(type)||(type==='fileChange'&&!executionSurface.fileChange)||(type==='webSearch'&&!executionSurface.webSearch)||(type==='commandExecution'&&!executionSurface.commandExecution);
          if(actionViolation){interrupt();const error=new Error(`EXECUTION_SURFACE_VIOLATION: ${type||'unknown'} exceeds the projected Runtime execution surface.`);error.nonRetryable=true;error.authorityViolation=true;throw error;}
          const observed=workUnitObserver?.start(item,Date.now());if(observed)toolCallCount=workUnitObserver.records.length;else if(type==='commandExecution')toolCallCount+=1;
          if(type==='commandExecution')onProgress?.({summary:'正在核对证据',detail:commandDetail});else if(type==='fileChange')onProgress?.({summary:'Codex 正在处理文件变更',detail:fileChangeDetail});continue;
        }
        if(event.method==='item/completed'){
          const item=event.params?.item;workUnitObserver?.complete(item,Date.now());
          if(item?.type==='agentMessage'&&typeof item.text==='string'&&item.text.trim()){agentMessages.push(item.text);onProgress?.({summary:'Codex 已形成阶段输出',detail:formedDetail});}
          else if(item?.type==='commandExecution')onProgress?.({summary:'证据检查完成',detail:'正在根据刚取得的证据形成当前 Work Unit 结果。'});continue;
        }
        completed=event;
      }
      const turn=completed.params.turn;if(turn.status!=='completed'){const error=new Error(turn.error?.message||`Codex turn ${turn.status}`);if(turn.status==='interrupted'||signal?.aborted)error.interrupted=true;throw error;}
      const fallback=Array.isArray(turn.items)?[...turn.items].reverse().find(i=>i?.type==='agentMessage'&&typeof i.text==='string'&&i.text.trim())?.text:null,finalText=agentMessages.length?agentMessages[agentMessages.length-1]:fallback;if(!finalText)throw new Error('Codex returned no final agent message');
      const usage=turn?.usage||turn?.tokenUsage||turn?.tokens||null;this.recordDiagnostic('turn-completed',{...routeMeta,threadId,turnId,resolvedModel:turn?.model||turn?.modelId||resolvedTurnModel||null,elapsedMs:Date.now()-executionStartedAt,toolCallCount,outputBytes:Buffer.byteLength(finalText,'utf8'),usage:usage&&typeof usage==='object'?usage:null,activeTurnCount:this.activeTurnCount});
      if(workUnitObserver)setTimeout(()=>failWorkUnitObservability({taskId:routeMeta.taskId,workUnitId:routeMeta.workUnitId,status:'diagnostic-finalization-timeout',blocker:'Structured Work Unit result was not finalized after transport completion.'}),5_000).unref?.();
      onProgress?.({summary:'Codex 本轮执行完成',detail:completedDetail});return finalText;
    }catch(error){
      if(workUnitObserver)try{failWorkUnitObservability({taskId:routeMeta.taskId,workUnitId:routeMeta.workUnitId,status:error?.interrupted||signal?.aborted?'interrupted':'failed',blocker:error?.message||String(error)});}catch{/* diagnostics only */}
      this.recordDiagnostic('turn-failed',{...routeMeta,threadId,turnId,resolvedModel:resolvedTurnModel||null,elapsedMs:Date.now()-executionStartedAt,toolCallCount,activeTurnCount:this.activeTurnCount,interrupted:Boolean(error?.interrupted||signal?.aborted),error:error?.message||String(error)},error?.interrupted?'warn':'error');throw error;
    }finally{signal?.removeEventListener?.('abort',interrupt);this.activeTurnCount=Math.max(0,this.activeTurnCount-1);this.recordDiagnostic('turn-released',{...routeMeta,threadId,turnId,activeTurnCount:this.activeTurnCount},'debug');}
  }

  close(){const error=new Error('Codex app-server closed');error.interrupted=true;this.failAll(error);try{this.child?.stdin?.end();}catch{/* ignore */}try{this.child?.kill();}catch{/* ignore */}this.child=null;this.initialized=false;this.connectPromise=null;}
}
