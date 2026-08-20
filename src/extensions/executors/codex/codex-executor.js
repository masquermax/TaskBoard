import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, resolve } from 'node:path';
import { ExecutorPort } from '../../../core/executor-port.js';
import { CodexAppServerClient } from './app-server-client.js';

function text(value){return String(value==null?'':value).trim();}
function list(value){return Array.isArray(value)?value:[];}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function isSupportedLocalImage(attachment){const ext=extname(attachment?.name||'').toLowerCase();return['.png','.jpg','.jpeg','.gif','.webp'].includes(ext)||['image/png','image/jpeg','image/gif','image/webp'].includes(String(attachment?.mimeType||'').toLowerCase());}
function safeParse(value){if(value&&typeof value==='object')return value;const parsed=JSON.parse(String(value||''));if(!parsed||typeof parsed!=='object')throw new Error('Invalid structured Codex response');return parsed;}
function commandProbe(command,args=['--version']){try{const result=spawnSync(command,args,{encoding:'utf8',timeout:3_000,windowsHide:true,shell:process.platform==='win32'});return result.status===0;}catch{return false;}}
function fileExistsAny(paths=[]){return paths.filter(Boolean).some(path=>existsSync(path));}

export function probeExecutionEnvironment(){
  const python=process.env.PYTHON||'python',pythonAvailable=commandProbe(python,['--version']);let pythonModules={pdf2image:false,lxml:false};
  if(pythonAvailable){try{const script="import importlib.util,json;print(json.dumps({m: bool(importlib.util.find_spec(m)) for m in ['pdf2image','lxml']}))",result=spawnSync(python,['-c',script],{encoding:'utf8',timeout:3_000,windowsHide:true,shell:process.platform==='win32'});if(result.status===0){const parsed=JSON.parse(String(result.stdout||'{}').trim()||'{}');pythonModules={pdf2image:Boolean(parsed.pdf2image),lxml:Boolean(parsed.lxml)};}}catch{/* conservative false */}}
  const programFiles=process.env.ProgramFiles||'C:\\Program Files',programFilesX86=process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)';
  const libreOfficeAvailable=process.platform==='win32'?fileExistsAny([`${programFiles}\\LibreOffice\\program\\soffice.exe`,`${programFilesX86}\\LibreOffice\\program\\soffice.exe`]):fileExistsAny(['/usr/bin/libreoffice','/usr/local/bin/libreoffice']);
  const wordBinaryAvailable=process.platform==='win32'&&fileExistsAny([`${programFiles}\\Microsoft Office\\root\\Office16\\WINWORD.EXE`,`${programFilesX86}\\Microsoft Office\\root\\Office16\\WINWORD.EXE`]);
  return{checkedAt:new Date().toISOString(),rg:commandProbe('rg',['--version']),python:pythonAvailable?python:null,pythonModules,libreOffice:libreOfficeAvailable,wordDesktopBinary:wordBinaryAvailable};
}

/**
 * CodexExecutor owns only Codex/runtime realization. TaskBoard Core already
 * compiled instructions, context, responseContract, AuthorizedGrant and modelPolicy.
 */
export class CodexExecutor extends ExecutorPort{
  constructor({runtimeRoot,client=new CodexAppServerClient(),capabilityProvider=null,networkAccess=process.env.TASKBOARD_CODEX_NETWORK!=='0',environmentProbe=probeExecutionEnvironment}){super();this.runtimeRoot=runtimeRoot;this.client=client;this.capabilityProvider=capabilityProvider;this.networkAccess=networkAccess;this.environmentProbe=environmentProbe;this.environmentSnapshot=null;}

  environmentCapabilities(){if(!this.environmentSnapshot){this.environmentSnapshot=this.environmentProbe();this.client.recordDiagnostic?.('environment-capability-snapshot',this.environmentSnapshot);}return this.environmentSnapshot;}
  runtimeContext(){return this.environmentCapabilities();}

  readiness(){
    const current=this.client.scanRuntime?.()||this.client.runtimeStatus?.();
    if(current&&!current.available){this.client.startRuntimePreparation?.();const next=this.client.runtimeStatus?.()||current;if(next.preparing)return{ready:false,preparing:true,reason:'executor-runtime-preparing',message:'Codex 执行组件正在后台准备，无需操作。'};return{ready:false,preparing:false,reason:'executor-runtime-unavailable',message:'Codex 执行组件当前未就绪。请检查网络或本机 Codex 环境，恢复后 Scheduler 会自动继续。'};}
    if(this.capabilityProvider){const capability=this.capabilityProvider.snapshot?.()||null;if(!capability){void this.capabilityProvider.initialize?.({backgroundRefresh:true})?.catch?.(()=>{});return{ready:false,preparing:true,reason:'executor-connection-preparing',message:'Codex 连接正在验证，验证完成后任务会自动继续。'};}if(capability.execution?.connected===false){void this.capabilityProvider.initialize?.({backgroundRefresh:true})?.catch?.(()=>{});return{ready:false,preparing:true,reason:'executor-connection-preparing',message:'Codex 连接正在恢复，恢复后任务会自动继续。'};}if(capability.execution?.ready===false){const authRequired=capability.provider?.requiresOpenaiAuth===true;return authRequired?{ready:false,preparing:false,reason:'executor-auth-required',message:'Codex 当前登录已失效或未登录，请先在 Codex 重新登录，再到简易配置点击「应用 AI 连接」。'}:{ready:false,preparing:false,reason:'executor-connection-not-ready',message:'当前 AI 连接尚未通过 Runtime 验证，请检查连接配置后重新应用。'};}}
    return{ready:true,preparing:false,reason:null,message:null};
  }

  async health(){
    const runtime=this.client.scanRuntime?.()||this.client.runtimeStatus?.();if(runtime&&!runtime.available&&!this.client.initialized){this.client.startRuntimePreparation?.();const current=this.client.runtimeStatus?.()||runtime;return{executor:'codex',displayName:'Codex',available:false,connected:false,ready:false,authenticated:false,preparing:Boolean(current.preparing),runtimeState:current.state||null,runtimeSource:current.source||null,version:current.version||null,error:current.preparing?null:(current.error||'Codex runtime unavailable')};}
    const capability=this.capabilityProvider?.initialize?await this.capabilityProvider.initialize({backgroundRefresh:true}):(this.capabilityProvider?.discover?await this.capabilityProvider.discover():null);if(capability){const provider=capability.provider||{};return{executor:'codex',displayName:'Codex',available:capability.execution.available,connected:capability.execution.connected,ready:capability.execution.ready,authenticated:provider.requiresOpenaiAuth===false?true:(provider.authMode?true:null),version:capability.execution.version,authMode:provider.authMode||null,planType:provider.planType||null,providerId:provider.id||null,capabilityLevel:capability.discoveryLevel,modelCount:capability.models.length,model:capability.defaults?.model||null,catalogState:capability.catalogState||null,modelRefresh:this.capabilityProvider?.refreshState?.()||null,lastModelRefresh:capability.lastRefresh||null,error:capability.execution.error||null};}return{executor:'codex',displayName:'Codex',...(await this.client.health())};
  }

  close(){this.client.close?.();}
  taskWorkspace(taskId){const dir=resolve(this.runtimeRoot,String(taskId||'task'));mkdirSync(dir,{recursive:true});return dir;}
  executionWorkspace(taskId,executionId='execution'){const safe=String(executionId||'execution').replace(/[^A-Za-z0-9._-]/g,'_'),dir=resolve(this.taskWorkspace(taskId),'executions',safe);mkdirSync(dir,{recursive:true});return dir;}
  cleanupTaskWorkspace(taskId){try{rmSync(resolve(this.runtimeRoot,String(taskId)),{recursive:true,force:true});return true;}catch{return false;}}

  executionScope(request={}){
    const grant=request.authorizedGrant;if(!grant){const error=new Error('AUTHORIZED_GRANT_REQUIRED: TaskBoard Core did not provide Runtime authority.');error.nonRetryable=true;throw error;}
    const runtime=request.runtime||{},paths=list(runtime.projectPaths).map(path=>resolve(path)).filter(Boolean),scratch=this.executionWorkspace(runtime.taskId,runtime.executionId);const projectAccess=String(grant.projectAccess||'none');
    if(!['none','read','write'].includes(projectAccess)){const error=new Error(`AUTHORIZED_GRANT_PROJECT_ACCESS_INVALID: ${projectAccess}`);error.nonRetryable=true;throw error;}
    if(projectAccess!=='none'&&!paths.length){const error=new Error('AUTHORIZED_GRANT_SCOPE_MISMATCH: Project access was granted without a compiled Project path.');error.nonRetryable=true;throw error;}
    if(grant.networkAccess===true&&this.networkAccess!==true){const error=new Error('RUNTIME_CAPABILITY_UNAVAILABLE: this Codex Executor cannot realize the requested network capability.');error.nonRetryable=true;error.runtimeUnavailable=true;throw error;}
    const runtimeWorkspaceRoots=[scratch,...(projectAccess!=='none'?paths:[])],fileAccess=projectAccess==='write'?'write':'read',networkAccess=grant.networkAccess===true,permissionProfile='taskboard_runtime',suppressEnvironmentContext=grant.environmentAccess==='none';
    const runtimeConfig={permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':fileAccess}},network:{enabled:networkAccess}}},features:{plugins:false,connectors:false,apps:false},skills:{include_instructions:false},web_search:networkAccess?'live':'disabled',include_apps_instructions:false,allow_login_shell:false,...(suppressEnvironmentContext?{include_environment_context:false,project_doc_max_bytes:0}:{})};
    return{cwd:scratch,writableRoots:fileAccess==='write'?runtimeWorkspaceRoots:[],scratch,projectAccess,permissionProfile,runtimeWorkspaceRoots,environments:null,runtimeConfig,networkAccess};
  }

  stageAttachments(attachments,scratch){
    const selected=list(attachments).filter(item=>item?.path&&existsSync(item.path));if(!selected.length)return[];
    const inputDir=resolve(scratch,'inputs');mkdirSync(inputDir,{recursive:true});
    return selected.map((attachment,index)=>{const safe=String(attachment.id||attachment.name||index+1).replace(/[^A-Za-z0-9._-]/g,'_'),extension=extname(attachment.name||attachment.path||''),target=resolve(inputDir,`${index+1}-${safe}${extension&&safe.toLowerCase().endsWith(extension.toLowerCase())?'':extension}`);copyFileSync(attachment.path,target);return{...attachment,path:target};});
  }
  attachmentInputs(attachments){return list(attachments).filter(isSupportedLocalImage).map(a=>({type:'localImage',path:a.path}));}

  prompt(request,scope,stagedAttachments){
    const runtimeInputs={
      projectRoots:scope.projectAccess==='none'?[]:list(request.runtime?.projectPaths),
      attachments:stagedAttachments.map(a=>({id:a.id||null,name:a.name||'',mimeType:a.mimeType||null,size:a.size??null,path:a.path})),
    };
    return `${text(request.instructions)}\n\nExecution context:\n${JSON.stringify({...clone(request.context||{}),runtimeInputs},null,2)}\n\nReturn only the structured response required by responseContract.`;
  }

  async execute(request={}){
    if(!text(request.instructions)){const error=new Error('EXECUTOR_INSTRUCTIONS_REQUIRED');error.nonRetryable=true;throw error;}
    if(!request.responseContract||typeof request.responseContract!=='object'){const error=new Error('EXECUTOR_RESPONSE_CONTRACT_REQUIRED');error.nonRetryable=true;throw error;}
    const scope=this.executionScope(request),stagedAttachments=this.stageAttachments(request.runtime?.attachments,scope.scratch),modelPolicy=request.modelPolicy||{};
    const value=await this.client.runTurn({
      ...scope,
      prompt:this.prompt(request,scope,stagedAttachments),
      inputItems:this.attachmentInputs(stagedAttachments),
      outputSchema:request.responseContract,
      model:modelPolicy.model||null,
      reasoningEffort:modelPolicy.reasoningEffort||null,
      networkAccess:scope.networkAccess,
      onProgress:request.onProgress||null,
      onExecutionStarted:request.onExecutionStarted||null,
      signal:request.signal||null,
      diagnosticContext:{taskId:request.runtime?.taskId||null,workUnitId:request.runtime?.workUnitId||null,projectAccess:scope.projectAccess,networkAccess:scope.networkAccess,routeReason:modelPolicy.routeReason||null,configuredDefaultModel:modelPolicy.configuredDefaultModel||null},
    });
    return safeParse(value);
  }
}
