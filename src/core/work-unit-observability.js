const TOOL_TYPES=new Set(['commandExecution','fileChange','webSearch']);
const ACTIVE_WORK_UNITS=new Map();

function text(value){return String(value==null?'':value).trim();}
function iso(ms){return Number.isFinite(ms)?new Date(ms).toISOString():null;}
function bytes(value){try{return Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value??''),'utf8');}catch{return 0;}}
function registryKey(taskId,workUnitId){return`${text(taskId)}\u0000${text(workUnitId)}`;}

function commandName(command){const raw=text(command);if(!raw)return'commandExecution';const first=raw.split(/(?:&&|\|\||;|\r?\n)/).map(part=>part.trim()).filter(Boolean)[0]||raw,match=first.match(/^(?:&\s*)?(?:"([^"]+)"|'([^']+)'|([^\s]+))/),executable=text(match?.[1]||match?.[2]||match?.[3]);return executable?executable.replace(/\\/g,'/').split('/').pop()||executable:'commandExecution';}
function operationClass(item){
  const type=text(item?.type);if(type==='fileChange')return'write';if(type==='webSearch')return'search';
  const command=text(item?.command).replace(/\s+/g,' ').toLowerCase();if(!command)return'execute';
  if(/(^|\s)(rg|grep|findstr|select-string|where|which)(\s|$)|get-childitem|\bfind\b/.test(command))return'search';
  if(/(^|\s)(cat|type|head|tail|more)(\s|$)|get-content|sed\s+-n/.test(command))return'read';
  if(/\b(node\s+--test|npm(?:\.cmd)?\s+(?:run\s+)?(?:test|verify|check)|pnpm\s+(?:test|verify)|yarn\s+(?:test|verify)|pytest|vitest|jest)\b/.test(command))return'test';
  if(/\bgit\s+(status|log|show|diff|branch|rev-parse|ls-files|grep|remote)\b/.test(command))return'git-inspect';
  if(/\bgit\s+(add|commit|push|merge|rebase|reset|checkout|switch|restore|clean)\b/.test(command))return'git-mutate';
  if(/\b(curl|wget|invoke-webrequest|iwr)\b/.test(command))return'network';
  return'execute';
}
function targetFor(item){if(item?.type==='webSearch')return text(item?.query||item?.url)||null;if(item?.type==='commandExecution')return text(item?.cwd)||null;if(item?.type==='fileChange')return text(item?.changes?.[0]?.path)||null;return null;}
function resultBytes(item){if(item?.type==='commandExecution')return bytes(item?.aggregatedOutput||'');if(item?.type==='fileChange')return bytes(item?.changes||[]);if(item?.type==='webSearch')return bytes(item?.results??item?.result??'');return 0;}
function succeeded(item){const status=text(item?.status).toLowerCase();if(item?.success===false)return false;if(['failed','declined','cancelled','canceled'].includes(status))return false;if(Number.isFinite(item?.exitCode))return Number(item.exitCode)===0;return status?['completed','success','succeeded'].includes(status):true;}
function publishSummary(observer,summary){if(!observer?.emitDiagnostic||!summary)return;const{event,...data}=summary;observer.emitDiagnostic(event,data,'info');}

export class WorkUnitObservability{
  constructor({taskId=null,workUnitId=null,turnId=null,startedAt=Date.now(),now=()=>Date.now(),emitDiagnostic=null}={}){this.taskId=taskId||null;this.workUnitId=workUnitId||null;this.turnId=turnId||null;this.startedAt=startedAt;this.now=now;this.emitDiagnostic=typeof emitDiagnostic==='function'?emitDiagnostic:null;this.records=[];this.active=new Map();this.finalized=false;}
  setTurnId(turnId){this.turnId=turnId||this.turnId;}
  isToolItem(item){return TOOL_TYPES.has(text(item?.type));}
  start(item,at=this.now()){
    if(!this.isToolItem(item))return null;const id=text(item?.id)||`tool-${this.records.length+1}`;if(this.active.has(id))return this.active.get(id);
    const record={id,seq:this.records.length+1,toolCallName:item?.type==='commandExecution'?commandName(item?.command):text(item?.type),toolType:text(item?.type),operationClass:operationClass(item),target:targetFor(item),startedAt:at,completedAt:null,durationMs:null,success:null,resultBytes:0};this.records.push(record);this.active.set(id,record);return record;
  }
  complete(item,at=this.now()){
    if(!this.isToolItem(item))return null;const id=text(item?.id)||null;let record=id?this.active.get(id):null;if(!record)record=this.start(item,at);if(!record)return null;
    record.completedAt=at;record.durationMs=Number.isFinite(item?.durationMs)?Number(item.durationMs):Math.max(0,at-record.startedAt);record.success=succeeded(item);record.resultBytes=resultBytes(item);record.target=targetFor(item)||record.target;this.active.delete(record.id);
    this.emitDiagnostic?.('tool-completed',{taskId:this.taskId,workUnitId:this.workUnitId,turnId:this.turnId,seq:record.seq,toolCallName:record.toolCallName,toolType:record.toolType,operationClass:record.operationClass,target:record.target,startedAt:iso(record.startedAt),durationMs:record.durationMs,success:record.success,resultBytes:record.resultBytes},'debug');return record;
  }
  finalize({evidence=null,completedAt=this.now(),status='completed',blocker=null}={}){
    if(this.finalized)return this.finalized;const operationCounts={};for(const record of this.records)operationCounts[record.operationClass]=(operationCounts[record.operationClass]||0)+1;
    const summary={event:'work-unit-summary',taskId:this.taskId,workUnitId:this.workUnitId,turnId:this.turnId,status,durationMs:Math.max(0,completedAt-this.startedAt),toolCallCount:this.records.length,operationCounts,evidenceCount:Array.isArray(evidence)?evidence.length:null,actualCompletionAt:iso(completedAt),blocker:text(blocker)||null};this.finalized={summary};return this.finalized;
  }
}

export function registerWorkUnitObservability(observer){if(!(observer instanceof WorkUnitObservability)||!text(observer.taskId)||!text(observer.workUnitId))return observer;ACTIVE_WORK_UNITS.set(registryKey(observer.taskId,observer.workUnitId),observer);return observer;}
export function finalizeWorkUnitObservability({taskId,workUnitId,evidence=null,completedAt=Date.now(),status='completed',blocker=null}={}){const key=registryKey(taskId,workUnitId),observer=ACTIVE_WORK_UNITS.get(key);if(!observer)return null;ACTIVE_WORK_UNITS.delete(key);const finalized=observer.finalize({evidence,completedAt,status,blocker});publishSummary(observer,finalized.summary);return finalized;}
export function failWorkUnitObservability({taskId,workUnitId,completedAt=Date.now(),status='failed',blocker=null}={}){return finalizeWorkUnitObservability({taskId,workUnitId,evidence:null,completedAt,status,blocker});}
export const WorkUnitObservabilityInternals={operationClass,commandName,registryKey};
