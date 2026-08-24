const TOOL_TYPES=Object.freeze({commandExecution:'commandExecution',command_execution:'commandExecution',fileChange:'fileChange',file_change:'fileChange',webSearch:'webSearch',web_search:'webSearch'});
const ACTIVE_WORK_UNITS=new Map();

function text(value){return String(value==null?'':value).trim();}
function iso(ms){return Number.isFinite(ms)?new Date(ms).toISOString():null;}
function bytes(value){try{return Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value??''),'utf8');}catch{return 0;}}
function registryKey(taskId,workUnitId){return`${text(taskId)}\u0000${text(workUnitId)}`;}
function toolType(item){return TOOL_TYPES[text(item?.type)]||null;}
function targetFor(item){const type=toolType(item);if(type==='webSearch')return text(item?.query||item?.url)||null;if(type==='commandExecution')return text(item?.cwd)||null;if(type==='fileChange')return text(item?.changes?.[0]?.path)||null;return null;}
function resultBytes(item){const type=toolType(item);if(type==='commandExecution')return bytes(item?.aggregatedOutput??item?.output??'');if(type==='fileChange')return bytes(item?.changes||[]);if(type==='webSearch')return bytes(item?.results??item?.result??item?.output??'');return 0;}
function succeeded(item){const status=text(item?.status).toLowerCase();if(item?.success===false)return false;if(['failed','declined','cancelled','canceled'].includes(status))return false;if(Number.isFinite(item?.exitCode))return Number(item.exitCode)===0;return status?['completed','success','succeeded'].includes(status):true;}
function publishSummary(observer,summary){if(!observer?.emitDiagnostic||!summary)return;const{event,...data}=summary;observer.emitDiagnostic(event,data,'info');}

/** Execution observability records factual tool/timing data only. */
export class WorkUnitObservability{
  constructor({taskId=null,workUnitId=null,turnId=null,startedAt=Date.now(),now=()=>Date.now(),emitDiagnostic=null}={}){this.taskId=taskId||null;this.workUnitId=workUnitId||null;this.turnId=turnId||null;this.startedAt=startedAt;this.now=now;this.emitDiagnostic=typeof emitDiagnostic==='function'?emitDiagnostic:null;this.records=[];this.active=new Map();this.finalized=false;}
  setTurnId(turnId){this.turnId=turnId||this.turnId;}
  isToolItem(item){return Boolean(toolType(item));}
  start(item,at=this.now()){
    const canonical=toolType(item);if(!canonical)return null;const id=text(item?.id)||`tool-${this.records.length+1}`;if(this.active.has(id))return this.active.get(id);
    const record={id,seq:this.records.length+1,toolType:canonical,target:targetFor(item),startedAt:at,completedAt:null,durationMs:null,success:null,resultBytes:0};this.records.push(record);this.active.set(id,record);return record;
  }
  complete(item,at=this.now()){
    if(!toolType(item))return null;const id=text(item?.id)||null;let record=id?this.active.get(id):null;if(!record)record=this.start(item,at);if(!record)return null;
    record.completedAt=at;record.durationMs=Number.isFinite(item?.durationMs)?Number(item.durationMs):Math.max(0,at-record.startedAt);record.success=succeeded(item);record.resultBytes=resultBytes(item);record.target=targetFor(item)||record.target;this.active.delete(record.id);
    this.emitDiagnostic?.('tool-completed',{taskId:this.taskId,workUnitId:this.workUnitId,turnId:this.turnId,seq:record.seq,toolType:record.toolType,target:record.target,startedAt:iso(record.startedAt),durationMs:record.durationMs,success:record.success,resultBytes:record.resultBytes},'debug');return record;
  }
  finalize({evidence=null,completedAt=this.now(),status='completed',blocker=null}={}){
    if(this.finalized)return this.finalized;
    const summary={event:'work-unit-summary',taskId:this.taskId,workUnitId:this.workUnitId,turnId:this.turnId,status,durationMs:Math.max(0,completedAt-this.startedAt),toolCallCount:this.records.length,evidenceCount:Array.isArray(evidence)?evidence.length:null,actualCompletionAt:iso(completedAt),blocker:text(blocker)||null};this.finalized={summary};return this.finalized;
  }
}

export function registerWorkUnitObservability(observer){if(!(observer instanceof WorkUnitObservability)||!text(observer.taskId)||!text(observer.workUnitId))return observer;ACTIVE_WORK_UNITS.set(registryKey(observer.taskId,observer.workUnitId),observer);return observer;}
export function finalizeWorkUnitObservability({taskId,workUnitId,evidence=null,completedAt=Date.now(),status='completed',blocker=null}={}){const key=registryKey(taskId,workUnitId),observer=ACTIVE_WORK_UNITS.get(key);if(!observer)return null;ACTIVE_WORK_UNITS.delete(key);const finalized=observer.finalize({evidence,completedAt,status,blocker});publishSummary(observer,finalized.summary);return finalized;}
export function failWorkUnitObservability({taskId,workUnitId,completedAt=Date.now(),status='failed',blocker=null}={}){return finalizeWorkUnitObservability({taskId,workUnitId,evidence:null,completedAt,status,blocker});}
export const WorkUnitObservabilityInternals={registryKey,toolType};
