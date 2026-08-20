import { analysisFieldsSchema, evidenceSchema, gapResolutionSchema } from '../governance/analysis-contract.js';
import { humanGatewayEvidenceId } from '../governance/human-gateway-evidence.js';
import { taskInputCatalog } from './task-input-scope.js';
import { unresolvedEffectAttempts } from './effect-recovery.js';

function text(value){return String(value==null?'':value).trim();}
function list(value){return Array.isArray(value)?value:[];}
function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}

const rootEvidenceSchema={...evidenceSchema,properties:{...evidenceSchema.properties,sourceType:{type:'string',enum:['human','reference']}}};
const effectClosureSchema={type:'object',properties:{effectAttemptId:{type:'string'},claimId:{type:'string'}},required:['effectAttemptId','claimId'],additionalProperties:false};

export const ROOT_RESPONSE_CONTRACT={
  type:'object',
  properties:{
    kind:{type:'string',enum:['complete','human_gateway','delegate']},summary:{type:'string'},finalResult:{type:['string','null']},
    ...analysisFieldsSchema,
    evidence:{type:'array',items:rootEvidenceSchema,maxItems:50},
    gateway:{anyOf:[{type:'null'},{type:'object',properties:{gapId:{type:'string'},question:{type:'string'},context:{type:'string'},options:{type:'array',items:{type:'string'},maxItems:6}},required:['gapId','question','context','options'],additionalProperties:false}]},
    gapResolutions:{type:'array',items:gapResolutionSchema,maxItems:30},
    delegations:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},goal:{type:'string'},expectedOutput:{type:'string'},stopCondition:{type:'string'},projectAccess:{type:'string',enum:['none','read','write']},networkAccess:{type:'boolean'},skillId:{type:['string','null']},dependsOn:{type:'array',items:{type:'string'}},inputRefs:{type:'array',items:{type:'string'},maxItems:40}},required:['id','title','goal','expectedOutput','stopCondition','projectAccess','networkAccess','skillId','dependsOn','inputRefs'],additionalProperties:false}},
    effectClosures:{type:'array',items:effectClosureSchema,maxItems:4},
  },
  required:['kind','summary','finalResult','resultMode','evidence','claims','gaps','recommendations','steps','gateway','gapResolutions','delegations'],
  additionalProperties:false,
};

export const SUBAGENT_RESPONSE_CONTRACT={
  type:'object',
  properties:{delegationId:{type:'string'},result:{type:'string'},evidence:{type:'array',items:evidenceSchema,maxItems:40},blocker:{type:['string','null']}},
  required:['delegationId','result','evidence','blocker'],
  additionalProperties:false,
};

function policyInstructions(policyContext){
  return text(policyContext?.prompt)||'TASKBOARD ROLE CONTEXT\nUse the structured runtime protocol supplied for this call.';
}

function recoveryInstructions(task){
  const attempts=unresolvedEffectAttempts(task?.executionState);if(!attempts.length)return'';
  const summary=attempts.map(item=>({id:item.id,workUnitId:item.workUnitId||null,projectAccess:item.projectAccess??'unknown',networkAccess:item.networkAccess??null,inputRefs:list(item.inputRefs),admittedAt:item.admittedAt||null,reason:item.reason||null,actuationClosed:item.actuationClosed===true}));
  return `\nRECOVERY OBSERVATION BOUNDARY — TaskBoard has an unresolved prior effect.\n- Transport/process loss does NOT prove the old effect failed, stopped, or left Reality unchanged. Effect outcome is UNKNOWN and old-mutator liveness is UNKNOWN unless independently proven otherwise.\n- Do not replay the old Work. Use only the minimum side-effect-free Work needed to reacquire current Reality / closure evidence. Runtime rejects new effect-capable admission while an old mutator can still compete.\n- A source-traced observation proves only what was observed at that boundary. Do not promote it into stable recovery truth, prior-effect attribution, or safe fresh actuation unless Evidence establishes the required stability/liveness relation.\n- Root alone may declare a mutator non-competing. When a CONFIRMED Claim establishes that the exact old mutator is terminal and cannot continue changing Reality, emit effectClosures=[{effectAttemptId,claimId}]. This closes only future actuation competition; it does NOT invent the historical effect outcome.\n- If that liveness closure is not established, emit no effectClosure and do not request fresh effect-capable Work.\n- Do not route this technical unknown to Human unless the remaining missing information or choice is genuinely human-owned.\nUnresolved effect attempts:\n${JSON.stringify(summary,null,2)}\n`;
}

function runtimeEnvelope(task,{executionId='execution',workUnitId=null,attachments=[],projectPaths=[]}={}){
  return{
    taskId:text(task?.id)||null,
    executionId:text(executionId)||'execution',
    workUnitId:text(workUnitId)||null,
    projectPaths:list(projectPaths).map(text).filter(Boolean),
    attachments:clone(list(attachments)),
  };
}

export function compileRootExecutorRequest({task,subagentResults=[],humanGatewayHistory=[],policyContext=null,certifiedContext=null,modelPolicy=null,onProgress=null,onExecutionStarted=null,signal=null,rejectionDelta=null}={}){
  const refs=list(task?.references).map(r=>({taskId:r?.source_task_id,title:r?.title,result:r?.final_result}));
  const resolvedHuman=list(humanGatewayHistory).filter(g=>g?.status==='RESOLVED').map(g=>({id:g.id,evidenceId:humanGatewayEvidenceId(g),targetGapId:g.targetGapId??g.target_gap_id??null,question:g.question,answer:g.answer}));
  const skillCatalog=list(policyContext?.skillCatalog);
  const instructions=`${policyInstructions(policyContext)}\n\nRoot protocol:\n- You are the sole Task-level reasoning owner. Within THIS turn, push the current semantic grid plus every fresh delta to a fixed point: old×old, new×old, and new×new relations may create further valid deductions. Continue until no additional decision-relevant Claim, Gap resolution, obligation relation, or next action follows from the supplied boundary.\n- Do not replay already-settled reasoning. Existing Claims/Gaps are the current semantic grid; fresh Work Unit results and Validator rejection deltas are new input. Emit only THIS TURN'S new/changed Evidence, Claims, Gaps, gapResolutions, presentation, and control action.\n- Root advances only by semantic judgment or by issuing the smallest sufficient Work Unit(s) for the remaining discriminator. If independent missing discriminators can run in parallel, issue them together. Never create work merely to re-check a settled grid cell.\n- Work Unit results are execution output plus source-traced Evidence, not Task truth. Root decides what they mean. When a Work Unit supplies an Evidence id, cite it from Claims/Gaps instead of rewriting it. Root evidence[] is only for Human/Reference material already present here.\n- Validator rejection means only that the rejected Candidate Delta was not admitted. Treat the supplied rejection as a deterministic new delta: correct the judgment, downgrade/withdraw unsupported material, or issue the minimum evidence-acquisition Work. Do not repeat the same rejected Candidate unchanged.\n- A CONFIRMED Claim may satisfy a governed obligation only when Root explicitly lists that obligation id in claim.obligationRefs[]. Completion will not reinterpret or infer this mapping.\n- kind=delegate emits NEW bounded Work Units with goal, expectedOutput, stopCondition, projectAccess, networkAccess, dependsOn, inputRefs and optional skillId. Use the minimum capabilities and inputs actually required. Runtime rejects invalid/duplicate plans instead of asking for a repair turn.\n- kind=human_gateway is only for a current blocking Gap genuinely owned by the human. gateway.gapId and question must exactly bind that Gap. Otherwise keep UNKNOWN as a Gap or issue a Reality-acquisition Work Unit.\n- kind=complete means Root judges no residual governed obligation remains unsatisfied. Runtime deterministically checks the explicit obligation mappings.\n- effectClosures is a Root-only control mapping. Use it only to bind an exact unresolved effectAttemptId to a CONFIRMED claimId that establishes old-mutator liveness closure; it never means the historical effect outcome is known.\n- Do not restate the Task, source material, search process, old Work receipts, or already-certified conclusions.\n\nAnalysis serialization:\n- Evidence is source-near material with locator + observation. DIRECT statement equals observation.\n- CONFIRMED Claims require DIRECT Evidence. Inference stays SUPPORTED. Unknown relationships stay Gaps. Recommendations cannot invent missing business rules.\n- steps[] cites CONFIRMED Claims only; finalResult stays null when resultMode=analysis because TaskBoard renders the certified structure.\n${recoveryInstructions(task)}`;
  const context={
    task:{id:task?.id||null,title:task?.title||'',instruction:task?.instruction||''},
    availableSkills:clone(skillCatalog),
    taskInputs:taskInputCatalog(task||{}),
    referencedResults:refs,
    resolvedHumanAnswers:resolvedHuman,
    freshWorkResults:clone(list(subagentResults)),
    certifiedContext:clone(certifiedContext||null),
    validatorRejection:rejectionDelta?clone(rejectionDelta):null,
  };
  return{
    instructions,context,responseContract:ROOT_RESPONSE_CONTRACT,
    authorizedGrant:clone(policyContext?.authorizedGrant||null),modelPolicy:clone(modelPolicy||null),
    runtime:runtimeEnvelope(task,{executionId:'root'}),onProgress,onExecutionStarted,signal,
  };
}

export function compileSubagentExecutorRequest({task,delegation,policyContext=null,modelPolicy=null,onProgress=null,onExecutionStarted=null,signal=null,executorContext=null}={}){
  const instructions=`${policyInstructions(policyContext)}\n\nWork Unit protocol:\n- Execute exactly workUnit.goal. workUnit.expectedOutput + workUnit.stopCondition are the complete semantic boundary. Stop immediately when that bounded output is established; unused time/tool budget is not work.\n- Use only the selected Task inputs and AuthorizedGrant capabilities. Do not expand the Task or select a new goal.\n- Return only result + traceable source-near Evidence + optional execution blocker. Do not classify Task truth, confidence, Gap, recommendation, completion, next work, effect closure, or what the result means.\n- Search output is only a locator. For a source-code fact, read the actual file and emit PROJECT_FILE Evidence with its concrete locator + observation.\n- If expectedOutput cannot be reached inside this boundary, return the blocker and stop. Root decides what happens next.\n- Executor Runtime Context is a supplied runtime fact; do not re-probe capabilities already marked unavailable.`;
  const context={
    task:{id:task?.id||null,title:task?.title||'',instruction:task?.instruction||''},
    selectedProjects:list(task?.projectScopes).map((scope,index)=>({ref:`project:${index}`,label:scope?.label||`Project ${index+1}`})),
    selectedAttachments:list(task?.attachments).map(a=>({id:a?.id||null,name:a?.name||'',mimeType:a?.mimeType||null,size:a?.size??null})),
    selectedReferencedResults:list(task?.references).map(r=>({taskId:r?.source_task_id,title:r?.title,result:r?.final_result})),
    workUnit:clone(delegation||{}),
    executorRuntime:clone(executorContext||null),
  };
  return{
    instructions,context,responseContract:SUBAGENT_RESPONSE_CONTRACT,
    authorizedGrant:clone(policyContext?.authorizedGrant||null),modelPolicy:clone(modelPolicy||null),
    runtime:runtimeEnvelope(task,{executionId:`work-${text(delegation?.id)||'unit'}`,workUnitId:delegation?.id||null,projectPaths:list(task?.projectScopes).map(scope=>scope?.path).filter(Boolean),attachments:list(task?.attachments)}),
    onProgress,onExecutionStarted,signal,
  };
}
