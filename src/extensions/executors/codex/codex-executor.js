import { humanGatewayEvidenceId } from '../../../governance/human-gateway-evidence.js';
import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { extname, resolve } from 'node:path';
import { ExecutorPort } from '../../../core/executor-port.js';
import { taskInputCatalog } from '../../../core/task-input-scope.js';
import { CodexAppServerClient } from './app-server-client.js';
import {
  analysisFieldsSchema,
  evidenceSchema,
  gapResolutionSchema,
} from '../../../governance/analysis-contract.js';

const rootEvidenceSchema={
  ...evidenceSchema,
  properties:{
    ...evidenceSchema.properties,
    sourceType:{type:'string',enum:['human','reference']},
  },
};

const rootSchema = {
  type:'object',
  properties:{
    kind:{type:'string',enum:['complete','human_gateway','delegate']},
    summary:{type:'string'},
    stageResult:{type:['string','null']},
    finalResult:{type:['string','null']},
    ...analysisFieldsSchema,
    evidence:{type:'array',items:rootEvidenceSchema,maxItems:50},
    gateway:{anyOf:[{type:'null'},{type:'object',properties:{gapId:{type:'string'},question:{type:'string'},context:{type:'string'},options:{type:'array',items:{type:'string'},maxItems:6}},required:['gapId','question','context','options'],additionalProperties:false}]},
    gapResolutions:{type:'array',items:gapResolutionSchema,maxItems:30},
    delegations:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},goal:{type:'string'},expectedOutput:{type:'string'},stopCondition:{type:'string'},projectAccess:{type:'string',enum:['none','read','write']},networkAccess:{type:'boolean'},skillId:{type:['string','null']},dependsOn:{type:'array',items:{type:'string'}},inputRefs:{type:'array',items:{type:'string'},maxItems:40}},required:['id','title','goal','expectedOutput','stopCondition','projectAccess','networkAccess','skillId','dependsOn','inputRefs'],additionalProperties:false}},
  },
  required:['kind','summary','stageResult','finalResult','resultMode','evidence','claims','gaps','recommendations','steps','gateway','gapResolutions','delegations'],
  additionalProperties:false,
};


const validatorSchema = {
  type:'object',
  properties:{
    reviews:{type:'array',items:{type:'object',properties:{id:{type:'string'},verdict:{type:'string',enum:['supported','overreach']},reason:{type:'string'}},required:['id','verdict','reason'],additionalProperties:false},maxItems:50},
  },
  required:['reviews'],
  additionalProperties:false,
};

const subagentFindingSchema = {
  type:'object',
  properties:{
    id:{type:'string'},
    statement:{type:'string'},
    evidenceIds:{type:'array',items:{type:'string'},maxItems:20},
  },
  required:['id','statement','evidenceIds'],
  additionalProperties:false,
};

const subagentSchema = {
  type:'object',
  properties:{
    delegationId:{type:'string'},
    result:{type:'string'},
    evidence:{type:'array',items:evidenceSchema,maxItems:40},
    findings:{type:'array',items:subagentFindingSchema,maxItems:30},
    discoveries:{type:'array',items:{type:'object',properties:{summary:{type:'string'},whyRelevant:{type:'string'},suggestedNextQuestion:{type:'string'}},required:['summary','whyRelevant','suggestedNextQuestion'],additionalProperties:false},maxItems:12},
    blocker:{type:['string','null']},
    uncertainty:{type:['string','null']},
  },
  required:['delegationId','result','evidence','findings','discoveries','blocker','uncertainty'],
  additionalProperties:false,
};



function isSupportedLocalImage(attachment){const ext=extname(attachment.name||'').toLowerCase();return ['.png','.jpg','.jpeg','.gif','.webp'].includes(ext)||['image/png','image/jpeg','image/gif','image/webp'].includes(String(attachment.mimeType||'').toLowerCase());}
function safeParse(text){const parsed=JSON.parse(text);if(!parsed||typeof parsed!=='object')throw new Error('Invalid structured Codex response');return parsed;}
function policyPrompt(policyContext){return policyContext?.prompt?.trim()||'TASKBOARD ROLE CONTEXT\nUse the structured runtime protocol supplied for this call.';}

function commandProbe(command,args=['--version']){
  try{const result=spawnSync(command,args,{encoding:'utf8',timeout:3_000,windowsHide:true,shell:process.platform==='win32'});return result.status===0;}catch{return false;}
}
function fileExistsAny(paths=[]){return paths.filter(Boolean).some(path=>existsSync(path));}
export function probeExecutionEnvironment(){
  const python=process.env.PYTHON||'python';
  const pythonAvailable=commandProbe(python,['--version']);
  let pythonModules={pdf2image:false,lxml:false};
  if(pythonAvailable){
    try{
      const script="import importlib.util,json;print(json.dumps({m: bool(importlib.util.find_spec(m)) for m in ['pdf2image','lxml']}))";
      const result=spawnSync(python,['-c',script],{encoding:'utf8',timeout:3_000,windowsHide:true,shell:process.platform==='win32'});
      if(result.status===0){const parsed=JSON.parse(String(result.stdout||'{}').trim()||'{}');pythonModules={pdf2image:Boolean(parsed.pdf2image),lxml:Boolean(parsed.lxml)};}
    }catch{/* keep conservative false values */}
  }
  const programFiles=process.env.ProgramFiles||'C:\\Program Files';
  const programFilesX86=process.env['ProgramFiles(x86)']||'C:\\Program Files (x86)';
  const libreOfficeAvailable=process.platform==='win32'
    ? fileExistsAny([`${programFiles}\\LibreOffice\\program\\soffice.exe`,`${programFilesX86}\\LibreOffice\\program\\soffice.exe`])
    : fileExistsAny(['/usr/bin/libreoffice','/usr/local/bin/libreoffice']);
  const wordBinaryAvailable=process.platform==='win32'&&fileExistsAny([`${programFiles}\\Microsoft Office\\root\\Office16\\WINWORD.EXE`,`${programFilesX86}\\Microsoft Office\\root\\Office16\\WINWORD.EXE`]);
  return {checkedAt:new Date().toISOString(),rg:commandProbe('rg',['--version']),python:pythonAvailable?python:null,pythonModules,libreOffice:libreOfficeAvailable,wordDesktopBinary:wordBinaryAvailable};
}

export class CodexExecutor extends ExecutorPort {
  constructor({runtimeRoot,client=new CodexAppServerClient(),capabilityProvider=null,networkAccess=process.env.TASKBOARD_CODEX_NETWORK!=='0',environmentProbe=probeExecutionEnvironment}){super();this.runtimeRoot=runtimeRoot;this.client=client;this.capabilityProvider=capabilityProvider;this.networkAccess=networkAccess;this.environmentProbe=environmentProbe;this.environmentSnapshot=null;}
  environmentCapabilities(){if(!this.environmentSnapshot){this.environmentSnapshot=this.environmentProbe();this.client.recordDiagnostic?.('environment-capability-snapshot',this.environmentSnapshot);}return this.environmentSnapshot;}
  readiness(){
    const current=this.client.scanRuntime?.()||this.client.runtimeStatus?.();
    if(!current)return{ready:true,preparing:false,reason:null,message:null};
    if(current.available)return{ready:true,preparing:false,reason:null,message:null};
    this.client.startRuntimePreparation?.();
    const next=this.client.runtimeStatus?.()||current;
    if(next.preparing)return{ready:false,preparing:true,reason:'executor-runtime-preparing',message:'Codex 执行组件正在后台准备，无需操作。'};
    return{ready:false,preparing:false,reason:'executor-runtime-unavailable',message:'Codex 执行组件当前未就绪。请检查网络或本机 Codex 环境，恢复后 Scheduler 会自动继续。'};
  }
  async health(){
    const runtime=this.client.scanRuntime?.()||this.client.runtimeStatus?.();
    if(runtime&&!runtime.available&&!this.client.initialized){
      this.client.startRuntimePreparation?.();
      const current=this.client.runtimeStatus?.()||runtime;
      return {executor:'codex',displayName:'Codex',available:false,connected:false,ready:false,authenticated:false,preparing:Boolean(current.preparing),runtimeState:current.state||null,runtimeSource:current.source||null,version:current.version||null,error:current.preparing?null:(current.error||'Codex runtime unavailable')};
    }
    const capability=this.capabilityProvider?.initialize?await this.capabilityProvider.initialize({backgroundRefresh:true}):(this.capabilityProvider?.discover?await this.capabilityProvider.discover():null);
    if(capability){
      const provider=capability.provider||{};
      return {executor:'codex',displayName:'Codex',available:capability.execution.available,connected:capability.execution.connected,ready:capability.execution.ready,authenticated:provider.requiresOpenaiAuth===false?true:(provider.authMode?true:null),version:capability.execution.version,authMode:provider.authMode||null,planType:provider.planType||null,providerId:provider.id||null,capabilityLevel:capability.discoveryLevel,modelCount:capability.models.length,model:capability.defaults?.model||null,catalogState:capability.catalogState||null,modelRefresh:this.capabilityProvider?.refreshState?.()||null,lastModelRefresh:capability.lastRefresh||null,error:capability.execution.error||null};
    }
    return {executor:'codex',displayName:'Codex',...(await this.client.health())};
  }
  close(){this.client.close?.();}
  taskWorkspace(task){const id=typeof task==='string'?task:task.id;const dir=resolve(this.runtimeRoot,id);mkdirSync(dir,{recursive:true});return dir;}
  workUnitWorkspace(task,workUnitId='work'){const safe=String(workUnitId||'work').replace(/[^A-Za-z0-9._-]/g,'_');const dir=resolve(this.taskWorkspace(task),'work-units',safe);mkdirSync(dir,{recursive:true});return dir;}
  cleanupTaskWorkspace(taskId){try{rmSync(resolve(this.runtimeRoot,String(taskId)),{recursive:true,force:true});return true;}catch{return false;}}
  executionScope(task,policyContext=null,{workUnitId=null}={}){
    const grant=policyContext?.authorizedGrant;
    if(!grant){const error=new Error('AUTHORIZED_GRANT_REQUIRED: GovernanceCompiler did not provide Runtime authority.');error.nonRetryable=true;throw error;}
    const role=String(grant.role||'');
    if(!['root','subagent','validator'].includes(role)){const error=new Error(`AUTHORIZED_GRANT_ROLE_INVALID: ${role||'missing'}`);error.nonRetryable=true;throw error;}
    const paths=(task.projectScopes||[]).map(s=>s.path).filter(Boolean).map(p=>resolve(p));
    const scratch=role==='subagent'?this.workUnitWorkspace(task,workUnitId):(resolve(this.taskWorkspace(task),role));mkdirSync(scratch,{recursive:true});
    const projectAccess=String(grant.projectAccess||'none');
    if(!['none','read','write'].includes(projectAccess)){const error=new Error(`AUTHORIZED_GRANT_PROJECT_ACCESS_INVALID: ${projectAccess}`);error.nonRetryable=true;throw error;}
    if(projectAccess!=='none'&&!paths.length){const error=new Error('AUTHORIZED_GRANT_SCOPE_MISMATCH: Project access was granted without a selected Project input.');error.nonRetryable=true;throw error;}
    const runtimeWorkspaceRoots=[scratch,...(projectAccess!=='none'?paths:[])];
    const fileAccess=projectAccess==='write'?'write':'read';
    const networkAccess=grant.networkAccess===true&&this.networkAccess===true;
    const permissionProfile='taskboard_runtime';
    const suppressEnvironmentContext=grant.environmentAccess==='none';
    const runtimeConfig={
      permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':fileAccess}},network:{enabled:networkAccess}}},
      features:{plugins:false,connectors:false,apps:false},
      skills:{include_instructions:false},
      web_search:networkAccess?'live':'disabled',
      include_apps_instructions:false,
      allow_login_shell:false,
      ...(suppressEnvironmentContext?{include_environment_context:false,project_doc_max_bytes:0}:{}),
    };
    return{cwd:scratch,writableRoots:fileAccess==='write'?runtimeWorkspaceRoots:[],scratch,projectAccess,permissionProfile,runtimeWorkspaceRoots,environments:null,runtimeConfig,networkAccess};
  }
  stageSelectedAttachments(task,scratch,attachments=task.attachments||[]){
    const selected=(Array.isArray(attachments)?attachments:[]).filter(item=>item?.path&&existsSync(item.path));
    if(!selected.length)return{...task,attachments:[]};
    const inputDir=resolve(scratch,'inputs');mkdirSync(inputDir,{recursive:true});
    const staged=selected.map((attachment,index)=>{
      const safe=String(attachment.id||attachment.name||index+1).replace(/[^A-Za-z0-9._-]/g,'_');
      const extension=extname(attachment.name||attachment.path||'');
      const target=resolve(inputDir,`${index+1}-${safe}${extension&&safe.toLowerCase().endsWith(extension.toLowerCase())?'':extension}`);
      copyFileSync(attachment.path,target);
      return{...attachment,path:target};
    });
    return{...task,attachments:staged};
  }
  attachmentInputs(task){return(task.attachments||[]).filter(isSupportedLocalImage).map(a=>({type:'localImage',path:a.path}));}
  validatorAttachmentInputs(task,candidates=[]){
    const visualEvidence=(Array.isArray(candidates)?candidates:[]).flatMap(candidate=>Array.isArray(candidate?.evidence)?candidate.evidence:[]).filter(e=>e?.sourceType==='attachment_visual');
    if(!visualEvidence.length)return[];
    const cited=(task.attachments||[]).filter(isSupportedLocalImage).filter(attachment=>visualEvidence.some(e=>{
      const locator=String(e?.locator||'');
      const name=String(attachment?.name||'').trim();
      const id=String(attachment?.id||'').trim();
      return Boolean((name&&locator.includes(name)) || (id&&locator.includes(id)));
    }));
    return cited.map(a=>({type:'localImage',path:a.path}));
  }

  rootPrompt({task,subagentResults,activeWork=[],humanGatewayHistory,policyContext=null,planningFeedback=null,scratchPath=null,validationFeedback=null,previousDecision=null,certifiedContext=null,authorityHandoff=false}){
    const refs=(task.references||[]).map(r=>({taskId:r.source_task_id,title:r.title,result:r.final_result}));
    const completedWork=(task.workReceipts||[]).map(receipt=>({id:receipt.id,title:receipt.workUnit?.title||receipt.id,goal:receipt.workUnit?.goal||'',inputRefs:receipt.workUnit?.inputRefs||[],projectAccess:receipt.workUnit?.projectAccess||'none',networkAccess:receipt.workUnit?.networkAccess===true,completedAt:receipt.completed_at||null}));
    const resolvedHuman=(humanGatewayHistory||[]).filter(g=>g.status==='RESOLVED').map(g=>({id:g.id,evidenceId:humanGatewayEvidenceId(g),targetGapId:g.targetGapId??g.target_gap_id??null,question:g.question,answer:g.answer}));
    const planningBlock=planningFeedback?.length?`\nWORK PLAN REPAIR — the Work Unit capability/dependency contract is invalid. Correct only these planning fields.\n${JSON.stringify(planningFeedback,null,2)}\n`:'';
    const validationBlock=validationFeedback?.length?`\nVALIDATOR FEEDBACK — the candidate content was not fully certifiable. Correct only the listed proof-boundary issues and preserve already certified content.\n${JSON.stringify(validationFeedback,null,2)}\nPrevious candidate:\n${JSON.stringify(previousDecision,null,2)}\n`:'';
    const authorityBlock=authorityHandoff?`\nCONTROL HANDOFF — the certified/narrowed content below is fixed input for this Turn. Choose the next Task control action from the certified state.\n`:'';
    const skillCatalog=Array.isArray(policyContext?.skillCatalog)?policyContext.skillCatalog:[];
    return `${policyPrompt(policyContext)}

Turn protocol:
- Evidence/Claims/Gaps are THIS TURN'S knowledge delta. Committed knowledge is carried forward by TaskBoard.
- When a Work Unit already supplies an Evidence id, cite that id from Claims/Gaps instead of rewriting it. Root evidence[] is only for Human/Reference material already present in Root context; project/attachment/search/runtime Evidence belongs to bounded Subagent work.
- Recommendations/Steps are current presentation over certified knowledge, not durable memory. On kind=complete return only the concise recommendations/steps that should be shown now.
- gapResolutions[] closes an existing Gap by id with reason + evidenceIds; omitted committed items remain unchanged. Resolved Human Gateway answers listed below already have system-owned DIRECT evidenceId values: cite those ids from Claims/Gap resolutions and do not copy the Human answer into evidence[]. Runtime will independently submit the bound Gateway Gap for proof even if Root omits that resolution.
- kind=delegate emits NEW bounded Work Units in delegations[] with goal, expectedOutput, stopCondition, projectAccess, networkAccess, dependsOn, inputRefs and optional skillId. inputRefs selects only the Task inputs needed by that Work Unit from the catalog below; use [] when no Task source is needed. Runtime separately enforces capacity and grants only the declared Project/network capabilities.
- kind=human_gateway is only for one unresolved blocking Gap that truly requires human information/choice. Set gateway.gapId to that exact Gap id and gateway.question to that Gap's exact certified question; context/options may explain choices but may not replace the question with a broader/narrower one. Non-blocking unknowns remain Gaps. kind=complete emits a completion candidate.
- Work Unit findings are local execution output, not Task truth. Root decides which supported findings become this Turn's Claims/Gaps/Recommendations; any Task-knowledge change must appear in this Turn's candidate delta even when the next control action is delegate.

Structured analysis serialization when resultMode=analysis:
- Evidence is source-near material with locator + observation. DIRECT statement equals observation.
- Claims cite Evidence; unknown relationships remain Gaps. A requirement statement proves what the requirement requires; it does not by itself prove that the implementation already behaves that way.
- Recommendations remain optional advice and must not replace an unresolved business rule with a self-invented default.
- steps[] cites one or more CONFIRMED Claims; finalResult stays null because TaskBoard renders the certified structure.
${planningBlock}${validationBlock}${authorityBlock}
Task:\n${JSON.stringify({id:task.id,title:task.title,instruction:task.instruction},null,2)}

Available Skills:\n${JSON.stringify(skillCatalog,null,2)}

Task Input Catalog (use these refs in Work Unit inputRefs):\n${JSON.stringify(taskInputCatalog(task),null,2)}

TaskBoard Scratch:\n${scratchPath||'(none)'}
Referenced completed Results:\n${JSON.stringify(refs,null,2)}
Completed Work Receipts (control history only; Task knowledge remains Current Certified State):\n${JSON.stringify(completedWork,null,2)}
Resolved Human Gateway answers:\n${JSON.stringify(resolvedHuman,null,2)}
Last valuable stage result:\n${task.last_stage_result||'(none)'}
Source-traced Work Unit results delivered to Root:\n${JSON.stringify(subagentResults||[],null,2)}
Active Work:\n${JSON.stringify(activeWork||[],null,2)}
Current certified Task state:\n${JSON.stringify(certifiedContext||null,null,2)}

Return only the structured response required by the output schema.`;
  }

  validatorPrompt({task,candidates,policyContext=null}){
    return `${policyPrompt(policyContext)}

Semantic proof obligation:
For each candidate, certify only the exact proof relation described by candidateType.
- candidateType=claim: verdict=supported only when the FULL Claim follows from the cited ORIGINAL source material within the declared scope/coverage.
- candidateType=gap_resolution: verdict=supported only when the exact Human Gateway question + answer actually resolves gapQuestion. Permission to continue under uncertainty does NOT mean the user selected a different scope, supplied a missing business fact, or authorized an unrelated assumption unless the answer explicitly says so.
- proofKind=requirement_fidelity_support: supported only when the immutable Requirement excerpt explicitly supports the semantic value; ambiguity is not authorization.
- proofKind=requirement_fidelity_contradiction: supported only when the Requirement explicitly contradicts the semantic value; absence is not contradiction.
- verdict=overreach means at least one required proof relation is missing; state that missing relation briefly.
- Evaluate only the supplied locator/observation and system-resolved sourceContext or cited visual attachment. Do not investigate or plan.

Task identity (context only): ${JSON.stringify({id:task.id,title:task.title},null,2)}
Candidates:\n${JSON.stringify(candidates||[],null,2)}

Return only the validator schema.`;
  }

  subagentPrompt({task,delegation,policyContext=null,validationFeedback=null}){
    const environment=this.environmentCapabilities();
    return `${policyPrompt(policyContext)}

Work Unit protocol:
- Execute only delegation.goal and delegation.expectedOutput; delegation.stopCondition is the execution boundary.
- delegation.projectAccess and delegation.networkAccess are the complete Runtime-granted Project/network capabilities for this Work Unit.
- evidence[] contains traceable source-near material found while executing this Work Unit.
- Search output is only a locator. When search finds a source-code fact, read the actual file and emit PROJECT_FILE Evidence with the concrete file locator + observation.
- findings[] contains only local findings from that evidence. Do not classify Task-level truth, gaps, recommendations, completion, or next work; Root owns those judgments.
- discoveries[] carries relevant observations outside the current Work Unit for Root planning.
- Executor Environment Snapshot below is a runtime fact. Do not re-probe capabilities already marked unavailable; choose an available path instead.
${validationFeedback?.length?`VALIDATION FEEDBACK — correct only these source-trace issues inside the same Work Unit. ${JSON.stringify(validationFeedback)}`:''}

Executor Environment Snapshot: ${JSON.stringify(environment)}
Task identity (context only): ${JSON.stringify({id:task.id,title:task.title},null,2)}
Selected Project Scope: ${JSON.stringify(task.projectScopes||[])}
Selected Attachments: ${JSON.stringify((task.attachments||[]).map(a=>({id:a.id,name:a.name,mimeType:a.mimeType,path:a.path})))}
Selected Referenced Results: ${JSON.stringify((task.references||[]).map(r=>({taskId:r.source_task_id,title:r.title,result:r.final_result})))}
Work Unit: ${JSON.stringify(delegation,null,2)}

Return only the structured Subagent result.`;
  }


  async runRoot(request){const scope=this.executionScope(request.task,request.policyContext,{role:'root'});const text=await this.client.runTurn({...scope,prompt:this.rootPrompt({...request,scratchPath:scope.scratch||null}),inputItems:[],outputSchema:rootSchema,model:request.modelPolicy?.model||null,reasoningEffort:request.modelPolicy?.reasoningEffort||null,networkAccess:scope.networkAccess,onProgress:request.onProgress||null,onExecutionStarted:request.onExecutionStarted||null,signal:request.signal||null,diagnosticContext:{taskId:request.task?.id||null,workUnitId:null,role:'root',routeReason:request.modelPolicy?.routeReason||null,configuredDefaultModel:request.modelPolicy?.configuredDefaultModel||null}});return safeParse(text);}
  async runSubagent(request){const scope=this.executionScope(request.task,request.policyContext,{workUnitId:request.delegation?.id});const stagedTask=this.stageSelectedAttachments(request.task,scope.scratch);const text=await this.client.runTurn({...scope,prompt:this.subagentPrompt({...request,task:stagedTask}),inputItems:this.attachmentInputs(stagedTask),outputSchema:subagentSchema,model:request.modelPolicy?.model||null,reasoningEffort:request.modelPolicy?.reasoningEffort||null,onProgress:request.onProgress||null,onExecutionStarted:request.onExecutionStarted||null,signal:request.signal||null,stopCondition:request.delegation?.stopCondition||null,diagnosticContext:{taskId:request.task?.id||null,workUnitId:request.delegation?.id||null,role:'subagent',projectAccess:scope.projectAccess,networkAccess:scope.networkAccess,routeReason:request.modelPolicy?.routeReason||null,configuredDefaultModel:request.modelPolicy?.configuredDefaultModel||null}});return safeParse(text);}
  async runValidator(request){const scope=this.executionScope(request.task,request.policyContext,{workUnitId:null});const cited=this.validatorAttachmentInputs(request.task,request.candidates).map(item=>(request.task.attachments||[]).find(attachment=>attachment.path===item.path)).filter(Boolean);const stagedTask=this.stageSelectedAttachments(request.task,scope.scratch,cited);const text=await this.client.runTurn({...scope,prompt:this.validatorPrompt({...request,task:stagedTask}),inputItems:this.attachmentInputs(stagedTask),outputSchema:validatorSchema,model:request.modelPolicy?.model||null,reasoningEffort:request.modelPolicy?.reasoningEffort||null,onProgress:request.onProgress||null,onExecutionStarted:request.onExecutionStarted||null,signal:request.signal||null,diagnosticContext:{taskId:request.task?.id||null,workUnitId:null,role:'validator',projectAccess:scope.projectAccess,networkAccess:scope.networkAccess,routeReason:request.modelPolicy?.routeReason||null,configuredDefaultModel:request.modelPolicy?.configuredDefaultModel||null}});return safeParse(text);}
}

export { rootSchema, subagentSchema, validatorSchema };