import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { TaskStatus, ReadyReason, CompletionReason, ProjectFilter } from './types.js';
import { migrateExecutionState, migrateReadyReason } from './runtime-state-migration.js';
import { bootstrapTaskContractState, createInitialTaskContractState, hydrateRequirementSources, hydrateTaskContract } from '../governance/task-contract.js';

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function emptyState() {
  return {
    counters:{ task:0,project:0,gateway:0,phase:0,scope:0,reference:0,progress:0 },
    projects:[],tasks:[],phaseHistory:[],scopes:[],references:[],gateways:[],attachments:[],progressHistory:[],maintenance:{},
  };
}

export class JsonTaskDatabase {
  constructor(filename) {
    this.filename = filename;
    mkdirSync(dirname(filename),{recursive:true});
    this.state = this.load();
    this.txDepth = 0;
  }
  load() {
    if (!existsSync(this.filename)) return emptyState();
    try {
      const parsed = JSON.parse(readFileSync(this.filename,'utf8'));
      const state = { ...emptyState(), ...parsed, counters:{ ...emptyState().counters, ...(parsed.counters || {}) }, maintenance:{ ...(parsed.maintenance || {}) } };
      for (const task of state.tasks) {
        task.ready_reason = migrateReadyReason(task.ready_reason);
        if (task.locked == null) task.locked = false;
        if (task.deleted_at === undefined) task.deleted_at = null;
        if (task.cancel_requested_at === undefined) task.cancel_requested_at = null;
        if (task.execution_state === undefined) task.execution_state = null;
        task.execution_state = migrateExecutionState(task.execution_state);
        if (task.analysis_state === undefined) task.analysis_state = null;
        if (!Array.isArray(task.work_receipts)) task.work_receipts = [];
        if (task.completion_reason === undefined) task.completion_reason = task.status === TaskStatus.COMPLETED ? CompletionReason.SUCCESS : null;
        const contractState = bootstrapTaskContractState(task);
        task.requirement_sources = contractState.requirement_sources;
        task.task_contract = contractState.task_contract;
      }
      return state;
    } catch (error) {
      throw new Error(`TASKBOARD_DATA_CORRUPT: ${error.message || error}`);
    }
  }
  persist() {
    const tmp = `${this.filename}.tmp`;
    writeFileSync(tmp,JSON.stringify(this.state,null,2),'utf8');
    renameSync(tmp,this.filename);
  }
  transaction(fn) {
    const snapshot = clone(this.state);
    this.txDepth += 1;
    try {
      const value = fn();
      this.txDepth -= 1;
      if (this.txDepth === 0) this.persist();
      return value;
    } catch (error) {
      this.state = snapshot;
      this.txDepth -= 1;
      throw error;
    }
  }
  nextId(counter,prefix) {
    this.state.counters[counter] = Number(this.state.counters[counter] || 0) + 1;
    if (this.txDepth === 0) this.persist();
    return `${prefix}-${String(this.state.counters[counter]).padStart(4,'0')}`;
  }
  close() { if (this.txDepth === 0) this.persist(); }
}

export class JsonTaskRepository {
  constructor(taskDatabase) { this.store = taskDatabase; }
  get state() { return this.store.state; }
  now() { return new Date().toISOString(); }

  createProject({name,path}) {
    const n=name.trim(),p=path.trim();
    if (this.state.projects.some(x=>x.name.toLowerCase()===n.toLowerCase())) throw new Error('PROJECT_NAME_EXISTS');
    if (this.state.projects.some(x=>x.path===p)) throw new Error('PROJECT_PATH_EXISTS');
    const id=this.store.nextId('project','P'),created_at=this.now();
    this.store.transaction(()=>this.state.projects.push({id,name:n,path:p,created_at}));
    return this.getProject(id);
  }
  listProjects(){ return clone([...this.state.projects].sort((a,b)=>a.name.localeCompare(b.name))); }
  getProject(id){ const p=this.state.projects.find(x=>x.id===id); return p?clone(p):null; }
  deleteProject(id){ const i=this.state.projects.findIndex(x=>x.id===id); if(i<0)return false; this.store.transaction(()=>{this.state.projects.splice(i,1);for(const s of this.state.scopes)if(s.project_id===id)s.project_id=null;});return true; }

  createTask({title,instruction,projectId=null,temporaryProjectPath=null,referenceTaskIds=[],executorKey='default',attachments=[]}) {
    const id=this.store.nextId('task','T'),now=this.now(),normalizedInstruction=instruction.trim();
    const contractState=createInitialTaskContractState({taskId:id,instruction:normalizedInstruction,createdAt:now});
    this.store.transaction(()=>{
      const project=projectId?this.state.projects.find(p=>p.id===projectId):null;
      if(projectId&&!project)throw new Error('PROJECT_NOT_FOUND');
      const refs=referenceTaskIds.map(sourceId=>{
        const source=this.state.tasks.find(t=>t.id===sourceId);
        if(!source||source.status!==TaskStatus.COMPLETED||source.deleted_at)throw new Error('REFERENCE_MUST_BE_COMPLETED');
        return source;
      });
      this.state.tasks.push({ id,title:title.trim(),instruction:normalizedInstruction,status:TaskStatus.READY,ready_reason:ReadyReason.NEW,status_entered_at:now,created_at:now,completed_at:null,completion_reason:null,last_stage_result:null,final_result:null,executor_key:executorKey,locked:false,deleted_at:null,cancel_requested_at:null,execution_state:null,analysis_state:null,work_receipts:[],requirement_sources:contractState.requirement_sources,task_contract:contractState.task_contract });
      this.addPhase(id,TaskStatus.READY,now);
      if(project)this.addScope({taskId:id,source:'registry',projectId:project.id,label:project.name,path:project.path,createdAt:now});
      if(temporaryProjectPath?.trim())this.addScope({taskId:id,source:'temporary',projectId:null,label:'临时项目范围',path:temporaryProjectPath.trim(),createdAt:now});
      for(const source of refs)if(!this.state.references.some(r=>r.source_task_id===source.id&&r.target_task_id===id))this.state.references.push({id:++this.state.counters.reference,source_task_id:source.id,target_task_id:id,created_at:now});
      for(const a of attachments)this.state.attachments.push({id:a.id,task_id:id,name:a.name,mime_type:a.mimeType,size_bytes:a.size,path:a.path,created_at:a.createdAt||now});
    });
    return this.getTask(id);
  }
  addPhase(taskId,phase,enteredAt){ this.state.phaseHistory.push({id:++this.state.counters.phase,task_id:taskId,phase,entered_at:enteredAt,exited_at:null}); }
  closeOpenPhase(taskId,at){ const p=[...this.state.phaseHistory].reverse().find(x=>x.task_id===taskId&&x.exited_at==null); if(p)p.exited_at=at; }
  addScope({taskId,source,projectId,label,path,createdAt}){ this.state.scopes.push({id:++this.state.counters.scope,task_id:taskId,source,project_id:projectId,label,path,created_at:createdAt}); }

  listTasks({status=TaskStatus.READY,title='',project=ProjectFilter.ALL}={}) {
    const keyword=title.trim().toLowerCase();
    return this.state.tasks.filter(t=>t.status===status&&!t.deleted_at).filter(t=>!keyword||t.title.toLowerCase().includes(keyword)).filter(t=>this.matchesProject(t.id,project))
      .sort((a,b)=>{
        if(status===TaskStatus.COMPLETED&&Boolean(a.locked)!==Boolean(b.locked))return a.locked?-1:1;
        return b.status_entered_at.localeCompare(a.status_entered_at)||b.created_at.localeCompare(a.created_at);
      }).map(t=>this.hydrateTask(t));
  }
  matchesProject(taskId,project){ if(!project||project===ProjectFilter.ALL)return true; const scopes=this.state.scopes.filter(s=>s.task_id===taskId); if(project===ProjectFilter.UNREGISTERED){return !scopes.some(s=>s.source==='registry'&&s.project_id!=null);} return scopes.some(s=>s.source==='registry'&&s.project_id===project); }
  listRunnableTasks(limit=20,nowMs=Date.now()) {
    return this.state.tasks.filter(t=>t.status===TaskStatus.READY&&!t.deleted_at&&!t.cancel_requested_at).sort((a,b)=>a.status_entered_at.localeCompare(b.status_entered_at)).map(t=>this.hydrateTask(t)).filter(task=>{
      const retry=task.executionState?.retry;
      if(task.ready_reason===ReadyReason.SUSPENDED||retry?.paused)return false;
      return !retry?.nextAt||new Date(retry.nextAt).getTime()<=nowMs;
    }).slice(0,limit);
  }
  getTask(id){ const t=this.state.tasks.find(x=>x.id===id); return t?this.hydrateTask(t):null; }
  hydrateTask(row){
    const scopes=this.state.scopes.filter(s=>s.task_id===row.id).sort((a,b)=>a.id-b.id);
    const refs=this.state.references.filter(r=>r.target_task_id===row.id).sort((a,b)=>a.id-b.id).map(r=>{const s=this.state.tasks.find(t=>t.id===r.source_task_id);return s?{source_task_id:s.id,title:s.title,final_result:s.final_result,completed_at:s.completed_at}:null;}).filter(Boolean);
    const g=[...this.state.gateways].filter(x=>x.task_id===row.id&&x.status==='PENDING').sort((a,b)=>b.created_at.localeCompare(a.created_at))[0]||null;
    const attachments=this.state.attachments.filter(a=>a.task_id===row.id).sort((a,b)=>a.created_at.localeCompare(b.created_at));
    return clone({ ...row,locked:Boolean(row.locked),ready_reason:migrateReadyReason(row.ready_reason),completion_reason:row.completion_reason||(row.status===TaskStatus.COMPLETED?CompletionReason.SUCCESS:null),executionState:migrateExecutionState(row.execution_state),analysisState:row.analysis_state||null,workReceipts:Array.isArray(row.work_receipts)?clone(row.work_receipts):[],requirementSources:hydrateRequirementSources(row.requirement_sources),taskContract:hydrateTaskContract(row.task_contract),
      projectScopes:scopes.map(s=>{const p=s.project_id?this.state.projects.find(x=>x.id===s.project_id):null;return{source:s.source,projectId:s.project_id,label:s.source==='registry'?(p?.name||s.label):(s.label||'临时项目范围'),path:s.source==='registry'?(p?.path||s.path):s.path};}),references:refs,
      attachments:attachments.map(a=>({id:a.id,name:a.name,mimeType:a.mime_type,size:a.size_bytes,path:a.path,createdAt:a.created_at})),pendingGateway:g?{...g,options:g.options||[]}:null });
  }
  getAttachment(taskId,attachmentId){const a=this.state.attachments.find(x=>x.task_id===taskId&&x.id===attachmentId);return a?clone({id:a.id,taskId:a.task_id,name:a.name,mimeType:a.mime_type,size:a.size_bytes,path:a.path,createdAt:a.created_at}):null;}

  transitionTask(id,nextStatus,{finalResult=null,lastStageResult=undefined,readyReason=undefined,completionReason=undefined,clearCancel=false,executionState=undefined}={}){
    const task=this.state.tasks.find(t=>t.id===id);if(!task)throw new Error('TASK_NOT_FOUND');const now=this.now();
    this.store.transaction(()=>{this.closeOpenPhase(id,now);this.addPhase(id,nextStatus,now);task.status=nextStatus;task.status_entered_at=now;if(readyReason!==undefined)task.ready_reason=readyReason;task.completed_at=nextStatus===TaskStatus.COMPLETED?now:null;task.completion_reason=nextStatus===TaskStatus.COMPLETED?(completionReason||CompletionReason.SUCCESS):null;if(finalResult!=null)task.final_result=finalResult;if(lastStageResult!==undefined&&lastStageResult!==null)task.last_stage_result=lastStageResult;if(clearCancel)task.cancel_requested_at=null;if(executionState!==undefined)task.execution_state=executionState;});
    return this.getTask(id);
  }
  touchTask(id,{readyReason=undefined,executionState=undefined}={}){const t=this.state.tasks.find(x=>x.id===id);if(!t)throw new Error('TASK_NOT_FOUND');this.store.transaction(()=>{if(readyReason!==undefined)t.ready_reason=readyReason;if(executionState!==undefined)t.execution_state=executionState;});return this.getTask(id);}
  updateStageResult(id,value){const t=this.state.tasks.find(x=>x.id===id);if(!t)throw new Error('TASK_NOT_FOUND');this.store.transaction(()=>{t.last_stage_result=value||null;});return this.getTask(id);}
  setExecutionState(id,state){const t=this.state.tasks.find(x=>x.id===id);if(!t)throw new Error('TASK_NOT_FOUND');this.store.transaction(()=>{t.execution_state=state;});return this.getTask(id);}
  commitWorkReceipt(taskId,receipt){
    const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');
    const value=clone(receipt||{});const id=String(value.id||value.workUnit?.id||'').trim(),signature=String(value.signature||'').trim();
    if(!id||!signature||!value.result||!value.workUnit)throw new Error('WORK_RECEIPT_INVALID');
    this.store.transaction(()=>{
      if(!Array.isArray(t.work_receipts))t.work_receipts=[];
      const byId=t.work_receipts.find(item=>String(item?.id||'')===id);
      if(byId&&String(byId.signature||'')!==signature)throw new Error('WORK_RECEIPT_ID_CONFLICT');
      const existing=t.work_receipts.find(item=>String(item?.signature||'')===signature);
      if(existing)return;
      t.work_receipts.push({...value,id,signature,completed_at:value.completed_at||this.now(),consumed_at:null});
    });
    return this.getTask(taskId);
  }
  consumeWorkReceipts(taskId,workReceiptIds=[]){
    const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');
    const consumed=new Set((Array.isArray(workReceiptIds)?workReceiptIds:[]).map(value=>String(value||'').trim()).filter(Boolean));
    if(!consumed.size)return this.getTask(taskId);
    this.store.transaction(()=>{for(const receipt of t.work_receipts||[])if(consumed.has(String(receipt?.id||''))&&!receipt.consumed_at)receipt.consumed_at=this.now();});
    return this.getTask(taskId);
  }
  commitCertifiedTurn(taskId,{analysisState,historyCommit=null,workReceiptIds=[]}){const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');this.store.transaction(()=>{t.analysis_state=analysisState==null?null:clone(analysisState);const consumed=new Set((Array.isArray(workReceiptIds)?workReceiptIds:[]).map(value=>String(value||'').trim()).filter(Boolean));if(consumed.size){for(const receipt of t.work_receipts||[])if(consumed.has(String(receipt?.id||''))&&!receipt.consumed_at)receipt.consumed_at=this.now();}if(historyCommit?.title&&historyCommit?.detail){this.state.progressHistory.push({id:++this.state.counters.progress,task_id:taskId,title:historyCommit.title,detail:historyCommit.detail,completed_at:historyCommit.completedAt||this.now()});t.last_stage_result=historyCommit.detail||null;}});return this.getTask(taskId);}
  setCancelRequested(id,value=true){const t=this.state.tasks.find(x=>x.id===id);if(!t)throw new Error('TASK_NOT_FOUND');this.store.transaction(()=>{t.cancel_requested_at=value?this.now():null;});return this.getTask(id);}
  setDeleted(id,value=true){const t=this.state.tasks.find(x=>x.id===id);if(!t)throw new Error('TASK_NOT_FOUND');this.store.transaction(()=>{t.deleted_at=value?this.now():null;});return this.getTask(id);}
  setLocked(id,locked){const t=this.state.tasks.find(x=>x.id===id);if(!t)throw new Error('TASK_NOT_FOUND');this.store.transaction(()=>{t.locked=Boolean(locked);});return this.getTask(id);}

  createGatewayRecord(taskId,{question,context='',options=[],gapId=null,targetGapId=null}){const task=this.state.tasks.find(t=>t.id===taskId);if(!task)throw new Error('TASK_NOT_FOUND');const id=this.store.nextId('gateway','HG'),now=this.now(),targetGap=String(targetGapId??gapId??'').trim()||null;this.store.transaction(()=>this.state.gateways.push({id,task_id:taskId,status:'PENDING',question,context,targetGapId:targetGap,options:[...options],answer:null,created_at:now,resolved_at:null}));return this.getTask(taskId);}
  resolveGatewayRecord(taskId,answer){const g=[...this.state.gateways].filter(x=>x.task_id===taskId&&x.status==='PENDING').sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];if(!g)throw new Error('NO_PENDING_GATEWAY');this.store.transaction(()=>{g.status='RESOLVED';g.answer=answer.trim();g.resolved_at=this.now();});return g.id;}
  cancelPendingGateway(taskId){this.store.transaction(()=>{for(const g of this.state.gateways)if(g.task_id===taskId&&g.status==='PENDING'){g.status='CANCELLED';g.resolved_at=this.now();}});}
  listGatewayHistory(taskId){return clone(this.state.gateways.filter(g=>g.task_id===taskId).sort((a,b)=>a.created_at.localeCompare(b.created_at)));}

  commitProgressHistory(taskId,{title,detail='',completedAt=null}){const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');this.store.transaction(()=>{this.state.progressHistory.push({id:++this.state.counters.progress,task_id:taskId,title,detail,completed_at:completedAt||this.now()});t.last_stage_result=detail||null;});return this.getTask(taskId);}
  getProgressHistory(taskId){return clone(this.state.progressHistory.filter(p=>p.task_id===taskId).sort((a,b)=>a.id-b.id));}
  getPhaseHistory(taskId){return clone(this.state.phaseHistory.filter(p=>p.task_id===taskId).sort((a,b)=>a.id-b.id).map(({phase,entered_at,exited_at})=>({phase,entered_at,exited_at})))}
  listStaleRunningTasks(){return this.state.tasks.filter(t=>t.status===TaskStatus.RUNNING).map(t=>this.hydrateTask(t));}
  counts(){const result={READY:0,RUNNING:0,WAITING_HUMAN:0,COMPLETED:0};for(const t of this.state.tasks)if(!t.deleted_at)result[t.status]=(result[t.status]||0)+1;return result;}

  getMaintenanceState(key){return this.state.maintenance[key]?clone(this.state.maintenance[key]):null;}
  setMaintenanceState(key,value){this.store.transaction(()=>{this.state.maintenance[key]=clone(value);});return clone(value);}
  listCleanupCandidates({today,maxAgeDays=90}){const todayKey=Date.UTC(today.getFullYear(),today.getMonth(),today.getDate());return this.state.tasks.filter(t=>t.status===TaskStatus.COMPLETED&&!t.locked&&t.completed_at&&!this.state.references.some(r=>r.source_task_id===t.id)).filter(t=>{const d=new Date(t.completed_at);const key=Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());return Math.floor((todayKey-key)/86400000)>maxAgeDays;}).map(t=>this.hydrateTask(t));}
  hardDeleteCompletedTask(id){const t=this.state.tasks.find(x=>x.id===id);if(!t||t.status!==TaskStatus.COMPLETED||t.locked||this.state.references.some(r=>r.source_task_id===id))return false;this.store.transaction(()=>{this.state.tasks=this.state.tasks.filter(x=>x.id!==id);this.state.phaseHistory=this.state.phaseHistory.filter(x=>x.task_id!==id);this.state.scopes=this.state.scopes.filter(x=>x.task_id!==id);this.state.references=this.state.references.filter(x=>x.target_task_id!==id);this.state.gateways=this.state.gateways.filter(x=>x.task_id!==id);this.state.attachments=this.state.attachments.filter(x=>x.task_id!==id);this.state.progressHistory=this.state.progressHistory.filter(x=>x.task_id!==id);});return true;}
}
