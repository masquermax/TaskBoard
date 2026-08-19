const TOOL_TYPES=new Set(['commandExecution','fileChange','webSearch']);

function text(value){return String(value==null?'':value).trim();}
function iso(ms){return Number.isFinite(ms)?new Date(ms).toISOString():null;}
function bytes(value){try{return Buffer.byteLength(typeof value==='string'?value:JSON.stringify(value??''),'utf8');}catch{return 0;}}
function normalizeSpace(value){return text(value).replace(/\s+/g,' ');}
function normalizePath(value){return text(value).replace(/\\/g,'/').replace(/^['"]|['"]$/g,'').replace(/[),;:]+$/g,'');}
function pathLike(value){const item=normalizePath(value);if(!item||item.length>500)return null;if(/^https?:\/\//i.test(item))return item;if(/^[A-Za-z]:\//.test(item))return item;if(/^(?:\.\.?\/)?(?:[\w.@+-]+\/)+[\w.@+()\[\]-]+(?:\.[A-Za-z0-9_-]+)?(?::\d+)?$/.test(item))return item.replace(/:\d+$/,'');if(/^[\w.@+()\[\]-]+\.[A-Za-z0-9_-]{1,12}(?::\d+)?$/.test(item))return item.replace(/:\d+$/,'');return null;}
function unique(values){return [...new Set(values.filter(Boolean))];}

function commandName(command){
  const raw=text(command);if(!raw)return'commandExecution';
  const segments=raw.split(/(?:&&|\|\||;|\r?\n)/).map(part=>part.trim()).filter(Boolean);
  const first=segments[0]||raw;
  const match=first.match(/^(?:&\s*)?(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
  const executable=text(match?.[1]||match?.[2]||match?.[3]);
  if(!executable)return'commandExecution';
  return executable.replace(/\\/g,'/').split('/').pop()||executable;
}

function operationClass(item){
  const type=text(item?.type);
  if(type==='fileChange')return'write';
  if(type==='webSearch')return'search';
  const command=normalizeSpace(item?.command).toLowerCase();
  if(!command)return'execute';
  if(/(^|\s)(rg|grep|findstr|select-string|where|which)(\s|$)|get-childitem|\bfind\b/.test(command))return'search';
  if(/(^|\s)(cat|type|head|tail|more)(\s|$)|get-content|sed\s+-n/.test(command))return'read';
  if(/\b(node\s+--test|npm(?:\.cmd)?\s+(?:run\s+)?(?:test|verify|check)|pnpm\s+(?:test|verify)|yarn\s+(?:test|verify)|pytest|vitest|jest)\b/.test(command))return'test';
  if(/\bgit\s+(status|log|show|diff|branch|rev-parse|ls-files|grep|remote)\b/.test(command))return'git-inspect';
  if(/\bgit\s+(add|commit|push|merge|rebase|reset|checkout|switch|restore|clean)\b/.test(command))return'git-mutate';
  if(/\b(curl|wget|invoke-webrequest|iwr)\b/.test(command))return'network';
  return'execute';
}

function commandSources(command,output=''){
  const values=[];
  const tokenPattern=/(?:[A-Za-z]:[\\/][^\s'"<>|]+|(?:\.\.?[\\/])?(?:[\w.@+()\[\]-]+[\\/])+[\w.@+()\[\]-]+(?:\.[A-Za-z0-9_-]+)?|[\w.@+()\[\]-]+\.[A-Za-z0-9_-]{1,12})(?::\d+)?/g;
  for(const source of [text(command),text(output)]){
    for(const match of source.matchAll(tokenPattern)){
      const value=pathLike(match[0]);if(value)values.push(value);
    }
  }
  return unique(values).slice(0,200);
}

function itemSources(item){
  const type=text(item?.type);
  if(type==='commandExecution')return commandSources(item?.command,item?.aggregatedOutput);
  if(type==='fileChange')return unique((Array.isArray(item?.changes)?item.changes:[]).map(change=>pathLike(change?.path))).slice(0,200);
  if(type==='webSearch')return unique([text(item?.query),text(item?.url),...(Array.isArray(item?.results)?item.results.map(result=>text(result?.url||result?.source)):[])]).slice(0,200);
  return[];
}

function targetFor(item,sources=[]){
  if(sources.length)return sources[0];
  if(item?.type==='webSearch')return text(item?.query)||null;
  if(item?.type==='commandExecution')return text(item?.cwd)||null;
  return null;
}

function resultBytes(item){
  if(item?.type==='commandExecution')return bytes(item?.aggregatedOutput||'');
  if(item?.type==='fileChange')return bytes(item?.changes||[]);
  if(item?.type==='webSearch')return bytes(item?.results??item?.result??item??'');
  return bytes(item??'');
}

function succeeded(item){
  const status=text(item?.status).toLowerCase();
  if(item?.success===false)return false;
  if(['failed','declined','cancelled','canceled'].includes(status))return false;
  if(Number.isFinite(item?.exitCode))return Number(item.exitCode)===0;
  return status?['completed','success','succeeded'].includes(status):true;
}

function operationFingerprint(item,opClass,sources=[]){
  if(item?.type==='commandExecution')return`commandExecution|${opClass}|${normalizeSpace(item?.command).toLowerCase()}`;
  if(item?.type==='fileChange')return`fileChange|${(Array.isArray(item?.changes)?item.changes:[]).map(change=>`${text(change?.kind)}:${normalizePath(change?.path)}`).sort().join('|')}`;
  if(item?.type==='webSearch')return`webSearch|${normalizeSpace(item?.query||item?.url||sources.join('|')).toLowerCase()}`;
  return`${text(item?.type)}|${normalizeSpace(JSON.stringify(item??{}))}`;
}

function stopCriteria(value){
  const raw=text(value);if(!raw)return[];
  const lines=raw.split(/\r?\n/).map(line=>line.replace(/^\s*(?:[-*•]|\d+[.)、]|[（(]?\d+[）)])\s*/,'').trim()).filter(Boolean);
  if(lines.length>1)return unique(lines);
  const clauses=raw.split(/[；;]/).map(item=>item.trim()).filter(Boolean);
  return clauses.length>1?unique(clauses):[raw];
}

function sourceMatchesLocator(source,locator){
  const left=normalizePath(source).toLowerCase();const right=normalizePath(locator).toLowerCase();
  if(!left||!right)return false;
  return left===right||left.includes(right)||right.includes(left)||left.split('/').pop()===right.split('/').pop();
}

export class WorkUnitObservability {
  constructor({taskId=null,workUnitId=null,turnId=null,startedAt=Date.now(),stopCondition='',now=()=>Date.now()}={}){
    this.taskId=taskId||null;this.workUnitId=workUnitId||null;this.turnId=turnId||null;this.startedAt=startedAt;this.stopCondition=text(stopCondition);this.now=now;
    this.records=[];this.active=new Map();this.operationFingerprints=new Set();this.sources=new Set();this.convergenceSteerAt=null;this.finalized=false;
  }

  setTurnId(turnId){this.turnId=turnId||this.turnId;}
  isToolItem(item){return TOOL_TYPES.has(text(item?.type));}

  start(item,at=this.now()){
    if(!this.isToolItem(item))return null;
    const id=text(item?.id)||`tool-${this.records.length+1}`;
    if(this.active.has(id))return this.active.get(id);
    const sources=itemSources(item);const opClass=operationClass(item);const fingerprint=operationFingerprint(item,opClass,sources);
    const record={id,seq:this.records.length+1,toolCallName:item?.type==='commandExecution'?commandName(item?.command):text(item?.type),toolType:text(item?.type),startedAt:at,completedAt:null,durationMs:null,operationClass:opClass,target:targetFor(item,sources),success:null,resultBytes:0,sources,duplicateOperation:this.operationFingerprints.has(fingerprint),fingerprint,newSourceCount:0,newEvidenceCount:0,elapsedSinceLastNewEvidenceMs:null};
    this.operationFingerprints.add(fingerprint);this.records.push(record);this.active.set(id,record);return record;
  }

  complete(item,at=this.now()){
    if(!this.isToolItem(item))return null;
    const id=text(item?.id)||null;let record=id?this.active.get(id):null;if(!record)record=this.start(item,at);if(!record)return null;
    const completedSources=itemSources(item);record.sources=unique([...record.sources,...completedSources]);record.target=targetFor(item,record.sources)||record.target;record.completedAt=at;record.durationMs=Number.isFinite(item?.durationMs)?Number(item.durationMs):Math.max(0,at-record.startedAt);record.success=succeeded(item);record.resultBytes=resultBytes(item);
    let newSourceCount=0;for(const source of record.sources){const normalized=normalizePath(source).toLowerCase();if(normalized&&!this.sources.has(normalized)){this.sources.add(normalized);newSourceCount+=1;}}record.newSourceCount=newSourceCount;this.active.delete(record.id);return record;
  }

  noteConvergenceSteer(at=this.now()){if(this.convergenceSteerAt==null)this.convergenceSteerAt=at;}

  finalize({evidence=[],completedAt=this.now(),status='completed',blocker=null,uncertainty=null}={}){
    if(this.finalized)return this.finalized;this.finalized=true;
    const verified=Array.isArray(evidence)?evidence:[];
    const unattributed=[];
    for(const evidenceItem of verified){
      const locator=text(evidenceItem?.locator);let matched=null;
      if(locator){matched=this.records.find(record=>record.sources.some(source=>sourceMatchesLocator(source,locator))||sourceMatchesLocator(record.target,locator));}
      if(matched)matched.newEvidenceCount+=1;else unattributed.push(evidenceItem);
    }
    const ordered=[...this.records].sort((a,b)=>a.seq-b.seq);let lastEvidenceAt=null;let firstEvidenceAt=null;let lastEvidenceSeq=null;
    for(const record of ordered){
      if(record.newEvidenceCount>0){const at=record.completedAt??record.startedAt;if(firstEvidenceAt==null)firstEvidenceAt=at;lastEvidenceAt=at;lastEvidenceSeq=record.seq;}
      record.elapsedSinceLastNewEvidenceMs=lastEvidenceAt==null?null:Math.max(0,(record.completedAt??record.startedAt)-lastEvidenceAt);
    }
    let evidenceTimingBasis='tool-source-attribution';
    if(verified.length&&!lastEvidenceAt){firstEvidenceAt=completedAt;lastEvidenceAt=completedAt;evidenceTimingBasis='turn-final-unattributed';}
    const toolCallCount=ordered.length;const uniqueToolCalls=this.operationFingerprints.size;const duplicateToolCalls=Math.max(0,toolCallCount-uniqueToolCalls);const postSaturationCalls=lastEvidenceSeq==null?(verified.length?null:toolCallCount):ordered.filter(record=>record.seq>lastEvidenceSeq).length;const callsAfterSteer=this.convergenceSteerAt==null?0:ordered.filter(record=>(record.startedAt??0)>=this.convergenceSteerAt).length;
    const criteria=stopCriteria(this.stopCondition);const cleanCompletion=status==='completed'&&!text(blocker)&&!text(uncertainty);const stopConditionProgress={satisfied:cleanCompletion?criteria.length:null,total:criteria.length,status:cleanCompletion?'reported-satisfied':'not-proven',basis:cleanCompletion?'work-unit-return-without-blocker':'runtime-observation',satisfiedAt:cleanCompletion?iso(completedAt):null};
    const toolEvents=ordered.map(record=>({event:'tool-completed',taskId:this.taskId,workUnitId:this.workUnitId,turnId:this.turnId,seq:record.seq,toolCallName:record.toolCallName,toolType:record.toolType,startedAt:iso(record.startedAt),durationMs:record.durationMs,operationClass:record.operationClass,target:record.target,success:record.success,resultBytes:record.resultBytes,newSourceCount:record.newSourceCount,newEvidenceCount:record.newEvidenceCount,duplicateOperation:record.duplicateOperation,elapsedSinceLastNewEvidenceMs:record.elapsedSinceLastNewEvidenceMs}));
    const summary={event:'work-unit-summary',taskId:this.taskId,workUnitId:this.workUnitId,turnId:this.turnId,status,durationMs:Math.max(0,completedAt-this.startedAt),toolCallCount,uniqueToolCalls,duplicateToolCalls,duplicateRatio:toolCallCount?Number((duplicateToolCalls/toolCallCount).toFixed(4)):0,uniqueSourcesTouched:this.sources.size,newEvidenceCount:verified.length,attributedEvidenceCount:verified.length-unattributed.length,unattributedEvidenceCount:unattributed.length,firstEvidenceAt:iso(firstEvidenceAt),lastNewEvidenceAt:iso(lastEvidenceAt),evidenceTimingBasis,postSaturationCalls,timeAfterLastNewEvidenceMs:lastEvidenceAt==null?null:Math.max(0,completedAt-lastEvidenceAt),convergenceSteerAt:iso(this.convergenceSteerAt),convergenceSteerElapsedMs:this.convergenceSteerAt==null?null:Math.max(0,this.convergenceSteerAt-this.startedAt),callsAfterConvergenceSteer:callsAfterSteer,stopConditionProgress,actualCompletionAt:iso(completedAt)};
    return{toolEvents,summary};
  }
}

export const WorkUnitObservabilityInternals={operationClass,commandName,itemSources,stopCriteria};
