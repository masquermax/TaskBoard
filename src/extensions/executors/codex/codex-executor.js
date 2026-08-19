import { humanGatewayEvidenceId } from '../../../governance/human-gateway-evidence.js';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, resolve } from 'node:path';
import { ExecutorPort } from '../../../core/executor-port.js';
import { taskInputCatalog } from '../../../core/task-input-scope.js';
import { unresolvedEffectAttempts } from '../../../core/effect-recovery.js';
import { CodexAppServerClient } from './app-server-client.js';
import { analysisFieldsSchema, evidenceSchema, gapResolutionSchema } from '../../../governance/analysis-contract.js';

const rootEvidenceSchema={...evidenceSchema,properties:{...evidenceSchema.properties,sourceType:{type:'string',enum:['human','reference']}}};
const rootSchema={
  type:'object',
  properties:{
    kind:{type:'string',enum:['complete','human_gateway','delegate']},summary:{type:'string'},stageResult:{type:['string','null']},finalResult:{type:['string','null']},
    ...analysisFieldsSchema,
    evidence:{type:'array',items:rootEvidenceSchema,maxItems:50},
    gateway:{anyOf:[{type:'null'},{type:'object',properties:{gapId:{type:'string'},question:{type:'string'},context:{type:'string'},options:{type:'array',items:{type:'string'},maxItems:6}},required:['gapId','question','context','options'],additionalProperties:false}]},
    gapResolutions:{type:'array',items:gapResolutionSchema,maxItems:30},
    delegations:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},goal:{type:'string'},expectedOutput:{type:'string'},stopCondition:{type:'string'},projectAccess:{type:'string',enum:['none','read','write']},networkAccess:{type:'boolean'},skillId:{type:['string','null']},dependsOn:{type:'array',items:{type:'string'}},inputRefs:{type:'array',items:{type:'string'},maxItems:40}},required:['id','title','goal','expectedOutput','stopCondition','projectAccess','networkAccess','skillId','dependsOn','inputRefs'],additionalProperties:false}},
  },
  required:['kind','summary','stageResult','finalResult','resultMode','evidence','claims','gaps','recommendations','steps','gateway','gapResolutions','delegations'],additionalProperties:false,
};
const subagentSchema={type:'object',properties:{delegationId:{type:'string'},result:{type:'string'},evidence:{type:'array',items:evidenceSchema,maxItems:40},blocker:{type:['string','null']}},required:['delegationId','result','evidence','blocker'],additionalProperties:false};

function isSupportedLocalImage(attachment){const ext=extname(attachment.name||'').toLowerCase();return['.png','.jpg','.jpeg','.gif','.webp'].includes(ext)||['image/png','image/jpeg','image/gif','image/webp'].includes(String(attachment.mimeType||'').toLowerCase());}
function safeParse(value){const parsed=JSON.parse(value);if(!parsed||typeof parsed!=='object')throw new Error('Invalid structured Codex response');return parsed;}
function policyPrompt(policyContext){return policyContext?.prompt?.trim()||'TASKBOARD ROLE CONTEXT\nUse the structured runtime protocol supplied for this call.';}
function recoveryPrompt(task){
  const attempts=unresolvedEffectAttempts(task?.executionState);if(!attempts.length)return'';
  const summary=attempts.map(item=>({id:item.id,workUnitId:item.workUnitId||null,projectAccess:item.projectAccess??'unknown',networkAccess:item.networkAccess??null,inputRefs:Array.isArray(item.inputRefs)?item.inputRefs:[],admittedAt:item.admittedAt||null,reason:item.reason||null}));
  return `\nRECOVERY OBSERVATION BOUNDARY — TaskBoard has an unresolved prior effect.\n- Transport/process loss does NOT prove the old effect failed, stopped, or left Reality unchanged. Effect outcome is UNKNOWN and old-mutator liveness is UNKNOWN unless independently proven otherwise.\n- Do not replay the old Work. Use only the minimum side-effect-free Work needed to reacquire current Reality / closure evidence. Runtime rejects new effect-capable admission while recovery remains unresolved.\n- A source-traced observation proves only what was observed at that boundary. Do not promote it into stable recovery truth, prior-effect attribution, or safe fresh actuation unless Evidence establishes the required stability/liveness relation.\n- Do not route this technical unknown to Human unless the remaining missing information or choice is genuinely human-owned.\nUnresolved effect attempts:\n${JSON.stringify(summary,null,2)}\n`;
}
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

export class CodexExecutor extends ExecutorPort{
  constructor({runtimeRoot,client=new CodexAppServerClient(),capabilityProvider=null,networkAccess=process.env.TASKBOARD_CODEX_NETWORK!=='0',environmentProbe=probeExecutionEnvironment}){super();this.runtimeRoot=runtimeRoot;this.client=client;this.capabilityProvider=capabilityProvider;this.networkAccess=networkAccess;this.environmentProbe=environmentProbe;this.environmentSnapshot=null;}
  environmentCapabilities(){if(!this.environmentSnapshot){this.environmentSnapshot=this.environmentProbe();this.client.recordDiagnostic?.('environment-capability-snapshot',this.environmentSnapshot);}return this.environmentSnapshot;}
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
  taskWorkspace(task){const id=typeof task==='string'?task:task.id,dir=resolve(this.runtimeRoot,id);mkdirSync(dir,{recursive:true});return dir;}
  workUnitWorkspace(task,workUnitId='work'){const safe=String(workUnitId||'work').replace(/[^A-Za-z0-9._-]/g,'_'),dir=resolve(this.taskWorkspace(task),'work-units',safe);mkdirSync(dir,{recursive:true});return dir;}
  cleanupTaskWorkspace(taskId){try{rmSync(resolve(this.runtimeRoot,String(taskId)),{recursive:true,force:true});return true;}catch{return false;}}
  executionScope(task,policyContext=null,{workUnitId=null}={}){
    const grant=policyContext?.authorizedGrant;if(!grant){const error=new Error('AUTHORIZED_GRANT_REQUIRED: GovernanceCompiler did not provide Runtime authority.');error.nonRetryable=true;throw error;}
    const role=String(grant.role||'');if(!['root','subagent'].includes(role)){const error=new Error(`AUTHORIZED_GRANT_ROLE_INVALID: ${role||'missing'}`);error.nonRetryable=true;throw error;}
    const paths=(task.projectScopes||[]).map(s=>s.path).filter(Boolean).map(p=>resolve(p)),scratch=role==='subagent'?this.workUnitWorkspace(task,workUnitId):resolve(this.taskWorkspace(task),role);mkdirSync(scratch,{recursive:true});
    const projectAccess=String(grant.projectAccess||'none');if(!['none','read','write'].includes(projectAccess)){const error=new Error(`AUTHORIZED_GRANT_PROJECT_ACCESS_INVALID: ${projectAccess}`);error.nonRetryable=true;throw error;}if(projectAccess!=='none'&&!paths.length){const error=new Error('AUTHORIZED_GRANT_SCOPE_MISMATCH: Project access was granted without a selected Project input.');error.nonRetryable=true;throw error;}
    if(grant.networkAccess===true&&this.networkAccess!==true){const error=new Error('RUNTIME_CAPABILITY_UNAVAILABLE: this Codex Executor cannot realize the Work Unit network requirement.');error.nonRetryable=true;error.runtimeUnavailable=true;throw error;}
    const runtimeWorkspaceRoots=[scratch,...(projectAccess!=='none'?paths:[])],fileAccess=projectAccess==='write'?'write':'read',networkAccess=grant.networkAccess===true,permissionProfile='taskboard_runtime',suppressEnvironmentContext=grant.environmentAccess==='none';
    const runtimeConfig={permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':fileAccess}},network:{enabled:networkAccess}}},features:{plugins:false,connectors:false,apps:false},skills:{include_instructions:false},web_search:networkAccess?'live':'disabled',include_apps_instructions:false,allow_login_shell:false,...(suppressEnvironmentContext?{include_environment_context:false,project_doc_max_bytes:0}:{})};
    return{cwd:scratch,writableRoots:fileAccess==='write'?runtimeWorkspaceRoots:[],scratch,projectAccess,permissionProfile,runtimeWorkspaceRoots,environments:null,runtimeConfig,networkAccess};
  }
  stageSelectedAttachments(task,scratch,attachments=task.attachments||[]){const selected=(Array.isArray(attachments)?attachments:[]).filter(item=>item?.path&&existsSync(item.path));if(!selected.length)return{...task,attachments:[]};const inputDir=resolve(scratch,'inputs');mkdirSync(inputDir,{recursive:true});const staged=selected.map((attachment,index)=>{const safe=String(attachment.id||attachment.name||index+1).replace(/[^A-Za-z0-9._-]/g,'_'),extension=extname(attachment.name||attachment.path||''),target=resolve(inputDir,`${index+1}-${safe}${extension&&safe.toLowerCase().endsWith(extension.toLowerCase())?'':extension}`);copyFileSync(attachment.path,target);return{...attachment,path:target};});return{...task,attachments:staged};}
  attachmentInputs(task){return(task.attachments||[]).filter(isSupportedLocalImage).map(a=>({type:'localImage',path:a.path}));}

  rootPrompt({task,subagentResults=[],humanGatewayHistory=[],policyContext=null,scratchPath=null,certifiedContext=null}){
    const refs=(task.references||[]).map(r=>({taskId:r.source_task_id,title:r.title,result:r.final_result})),resolvedHuman=(humanGatewayHistory||[]).filter(g=>g.status==='RESOLVED').map(g=>({id:g.id,evidenceId:humanGatewayEvidenceId(g),targetGapId:g.targetGapId??g.target_gap_id??null,question:g.question,answer:g.answer})),skillCatalog=Array.isArray(policyContext?.skillCatalog)?policyContext.skillCatalog:[],recoveryBlock=recoveryPrompt(task);
    return `${policyPrompt(policyContext)}

Root protocol:
- You are the sole Task-level reasoning owner. Within THIS turn, push the current semantic grid plus the fresh delta to a fixed point: old×old, new×old, and new×new relations may create further valid deductions. Continue until no additional decision-relevant Claim, Gap resolution, obligation relation, or next action follows from the supplied boundary.
- Do not replay already-settled reasoning. Existing Claims/Gaps are the current semantic grid; fresh Work Unit results are the new delta. Emit only THIS TURN'S new/changed Evidence, Claims, Gaps, gapResolutions, presentation, and control action.
- Root advances only by semantic judgment or by issuing the smallest sufficient Work Unit(s) for the remaining discriminator. If independent missing discriminators can run in parallel, issue them together. Never create work merely to re-check a settled grid cell.
- Work Unit results are execution output plus source-traced Evidence, not Task truth. Root decides what they mean. When a Work Unit supplies an Evidence id, cite it from Claims/Gaps instead of rewriting it. Root evidence[] is only for Human/Reference material already present here.
- A CONFIRMED Claim may satisfy a governed obligation only when Root explicitly lists that obligation id in claim.obligationRefs[]. Completion will not reinterpret or infer this mapping.
- kind=delegate emits NEW bounded Work Units with goal, expectedOutput, stopCondition, projectAccess, networkAccess, dependsOn, inputRefs and optional skillId. Use the minimum capabilities and inputs actually required. Runtime rejects invalid/duplicate plans instead of asking for a repair turn.
- kind=human_gateway is only for a current blocking Gap genuinely owned by the human. gateway.gapId and question must exactly bind that Gap. Otherwise keep UNKNOWN as a Gap or issue a Reality-acquisition Work Unit.
- kind=complete means Root judges no residual governed obligation remains unsatisfied. Runtime deterministically checks the explicit obligation mappings.
- Do not restate the Task, source material, search process, old Work receipts, or already-certified conclusions.

Analysis serialization:
- Evidence is source-near material with locator + observation. DIRECT statement equals observation.
- CONFIRMED Claims require DIRECT Evidence. Inference stays SUPPORTED. Unknown relationships stay Gaps. Recommendations cannot invent missing business rules.
- steps[] cites CONFIRMED Claims only; finalResult stays null when resultMode=analysis because TaskBoard renders the certified structure.
${recoveryBlock}
Task:\n${JSON.stringify({id:task.id,title:task.title,instruction:task.instruction},null,2)}

Available Skills:\n${JSON.stringify(skillCatalog,null,2)}
Task Input Catalog:\n${JSON.stringify(taskInputCatalog(task),null,2)}
Referenced completed Results:\n${JSON.stringify(refs,null,2)}
Resolved Human answers for this trigger:\n${JSON.stringify(resolvedHuman,null,2)}
Last valuable stage result:\n${task.last_stage_result||'(none)'}
Fresh Work Unit result delta:\n${JSON.stringify(subagentResults,null,2)}
Current semantic grid (Claims / Gaps / unresolved obligations):\n${JSON.stringify(certifiedContext||null,null,2)}
TaskBoard Scratch:\n${scratchPath||'(none)'}

Return only the structured response required by the output schema.`;
  }

  subagentPrompt({task,delegation,policyContext=null}){
    const environment=this.environmentCapabilities();
    return `${policyPrompt(policyContext)}

Work Unit protocol:
- Execute exactly delegation.goal. delegation.expectedOutput + delegation.stopCondition are the complete semantic boundary. Stop immediately when that bounded output is established; unused time/tool budget is not work.
- Use only the selected Task inputs and AuthorizedGrant capabilities. Do not expand the Task or select a new goal.
- Return only result + traceable source-near Evidence + optional execution blocker. Do not classify Task truth, confidence, Gap, recommendation, completion, next work, or what the result means.
- Search output is only a locator. For a source-code fact, read the actual file and emit PROJECT_FILE Evidence with its concrete locator + observation.
- If expectedOutput cannot be reached inside this boundary, return the blocker and stop. Root decides what happens next.
- Executor Environment Snapshot is a runtime fact; do not re-probe capabilities already marked unavailable.

Executor Environment Snapshot: ${JSON.stringify(environment)}
Task identity: ${JSON.stringify({id:task.id,title:task.title})}
Selected Project Scope: ${JSON.stringify(task.projectScopes||[])}
Selected Attachments: ${JSON.stringify((task.attachments||[]).map(a=>({id:a.id,name:a.name,mimeType:a.mimeType,path:a.path})))}
Selected Referenced Results: ${JSON.stringify((task.references||[]).map(r=>({taskId:r.source_task_id,title:r.title,result:r.final_result})))}
Work Unit: ${JSON.stringify(delegation,null,2)}

Return only the structured Subagent result.`;
  }

  async runRoot(request){const scope=this.executionScope(request.task,request.policyContext);const value=await this.client.runTurn({...scope,prompt:this.rootPrompt({...request,scratchPath:scope.scratch||null}),inputItems:[],outputSchema:rootSchema,model:request.modelPolicy?.model||null,reasoningEffort:request.modelPolicy?.reasoningEffort||null,networkAccess:scope.networkAccess,onProgress:request.onProgress||null,onExecutionStarted:request.onExecutionStarted||null,signal:request.signal||null,diagnosticContext:{taskId:request.task?.id||null,workUnitId:null,role:'root',routeReason:request.modelPolicy?.routeReason||null,configuredDefaultModel:request.modelPolicy?.configuredDefaultModel||null}});return safeParse(value);}
  async runSubagent(request){const scope=this.executionScope(request.task,request.policyContext,{workUnitId:request.delegation?.id}),stagedTask=this.stageSelectedAttachments(request.task,scope.scratch),value=await this.client.runTurn({...scope,prompt:this.subagentPrompt({...request,task:stagedTask}),inputItems:this.attachmentInputs(stagedTask),outputSchema:subagentSchema,model:request.modelPolicy?.model||null,reasoningEffort:request.modelPolicy?.reasoningEffort||null,onProgress:request.onProgress||null,onExecutionStarted:request.onExecutionStarted||null,signal:request.signal||null,diagnosticContext:{taskId:request.task?.id||null,workUnitId:request.delegation?.id||null,role:'subagent',projectAccess:scope.projectAccess,networkAccess:scope.networkAccess,routeReason:request.modelPolicy?.routeReason||null,configuredDefaultModel:request.modelPolicy?.configuredDefaultModel||null}});return safeParse(value);}
}

export { rootSchema, subagentSchema };
