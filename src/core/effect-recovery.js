import { workMayMutate } from './work-capability.js';

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function text(value){return String(value==null?'':value).trim();}
function stateObject(value){return value&&typeof value==='object'?clone(value):{};}

export function unresolvedEffectAttempts(executionState){
  const attempts=executionState?.recovery?.effectAttempts;
  return (Array.isArray(attempts)?attempts:[]).filter(item=>item&&item.resolved!==true&&text(item.id)).map(clone);
}

export function competingEffectAttempts(executionState){
  return unresolvedEffectAttempts(executionState).filter(item=>item.actuationClosed!==true);
}

export function hasUnresolvedEffectRecovery(executionState){
  return unresolvedEffectAttempts(executionState).length>0;
}

export function hasCompetingEffectActuation(executionState){
  return competingEffectAttempts(executionState).length>0;
}

export function addUnresolvedEffectAttempt(executionState,attempt){
  const state=stateObject(executionState);
  const current=unresolvedEffectAttempts(state);
  const value=clone(attempt||{});
  value.id=text(value.id);
  if(!value.id)return state;
  if(!current.some(item=>item.id===value.id))current.push(value);
  state.recovery={...(state.recovery&&typeof state.recovery==='object'?state.recovery:{}),effectAttempts:current};
  return state;
}

export function markEffectActuationClosed(executionState,closure={}){
  const state=stateObject(executionState);
  const effectAttemptId=text(closure?.effectAttemptId);
  const evidenceIds=[...new Set((Array.isArray(closure?.evidenceIds)?closure.evidenceIds:[]).map(text).filter(Boolean))];
  if(!effectAttemptId){const error=new Error('EFFECT_RECOVERY_CLOSURE_ID_REQUIRED');error.nonRetryable=true;throw error;}
  if(closure?.terminal!==true||closure?.canMutate!==false){const error=new Error('EFFECT_RECOVERY_CLOSURE_NOT_TERMINAL');error.nonRetryable=true;throw error;}
  if(!evidenceIds.length){const error=new Error('EFFECT_RECOVERY_CLOSURE_EVIDENCE_REQUIRED');error.nonRetryable=true;throw error;}
  const recovery=state.recovery&&typeof state.recovery==='object'?{...state.recovery}:{};
  const attempts=unresolvedEffectAttempts(state);
  const index=attempts.findIndex(item=>item.id===effectAttemptId);
  if(index<0){const error=new Error('EFFECT_RECOVERY_CLOSURE_IDENTITY_MISMATCH');error.nonRetryable=true;throw error;}
  attempts[index]={
    ...attempts[index],
    actuationClosed:true,
    actuationClosure:{
      terminal:true,
      canMutate:false,
      evidenceIds,
      observedAt:text(closure?.observedAt)||new Date().toISOString(),
    },
  };
  recovery.effectAttempts=attempts;
  state.recovery=recovery;
  return state;
}

export function clearUnresolvedEffectAttempt(executionState,attemptId){
  const state=stateObject(executionState);
  const id=text(attemptId);
  const recovery=state.recovery&&typeof state.recovery==='object'?{...state.recovery}:null;
  if(!recovery)return state;
  const next=unresolvedEffectAttempts(state).filter(item=>item.id!==id);
  if(next.length)recovery.effectAttempts=next;
  else delete recovery.effectAttempts;
  if(Object.keys(recovery).length)state.recovery=recovery;
  else delete state.recovery;
  return state;
}

export function withPreservedEffectRecovery(executionState,nextState={}){
  const next=stateObject(nextState);
  const recovery=executionState?.recovery;
  if(recovery&&typeof recovery==='object')next.recovery=clone(recovery);
  return next;
}

export function reconcileEffectReceipts(executionState,workReceipts=[]){
  let state=stateObject(executionState);
  const resolvedIds=new Set((Array.isArray(workReceipts)?workReceipts:[])
    .map(receipt=>text(receipt?.effectAttemptId))
    .filter(Boolean));
  for(const id of resolvedIds)state=clearUnresolvedEffectAttempt(state,id);
  return state;
}

function recoveredAttempt(task,unit,index){
  const workUnitId=text(unit?.id)||null;
  const knownProject=['none','read','write'].includes(String(unit?.projectAccess||''));
  const knownNetwork=typeof unit?.networkAccess==='boolean';
  return {
    id:`recovered:${text(task?.id)||'task'}:${workUnitId||index}`,
    workUnitId,
    signature:null,
    projectAccess:knownProject?String(unit.projectAccess):'unknown',
    networkAccess:knownNetwork?unit.networkAccess:null,
    inputRefs:Array.isArray(unit?.inputRefs)?unit.inputRefs.map(text).filter(Boolean):[],
    admittedAt:text(task?.status_entered_at)||new Date().toISOString(),
    reason:'stale-running-recovery',
    resolved:false,
  };
}

/**
 * Reconstruct only the minimum safety fact needed at a process boundary.
 * A successful durable WorkReceipt closes its own attempt. Otherwise a clearly
 * Root/Validator or read-only snapshot may resume; missing/ambiguous state never
 * proves that an old effect-capable executor failed to obtain control.
 */
export function recoverStaleEffectState(task){
  let state=reconcileEffectReceipts(task?.executionState,task?.workReceipts);
  if(hasUnresolvedEffectRecovery(state))return state;
  const snapshot=state?.snapshot;
  if(!snapshot){
    return addUnresolvedEffectAttempt(state,{
      id:`recovered:${text(task?.id)||'task'}:unknown`,workUnitId:null,signature:null,
      projectAccess:'unknown',networkAccess:null,inputRefs:[],
      admittedAt:text(task?.status_entered_at)||new Date().toISOString(),
      reason:'stale-running-without-runtime-snapshot',resolved:false,
    });
  }
  const running=(snapshot?.stage?.workUnits||[]).filter(unit=>unit?.status==='RUNNING');
  const ambiguous=running.filter(unit=>!['none','read','write'].includes(String(unit?.projectAccess||''))||typeof unit?.networkAccess!=='boolean');
  const effectful=running.filter(unit=>workMayMutate(unit));
  for(const [index,unit] of [...effectful,...ambiguous.filter(unit=>!effectful.includes(unit))].entries()){
    state=addUnresolvedEffectAttempt(state,recoveredAttempt(task,unit,index));
  }
  if(hasUnresolvedEffectRecovery(state))return state;
  const owner=text(snapshot?.actor?.owner);
  if(owner==='root'||owner==='validator'||running.length>0)return state;
  if(!snapshot?.actor&&!snapshot?.stage)return addUnresolvedEffectAttempt(state,{
    id:`recovered:${text(task?.id)||'task'}:ambiguous`,workUnitId:null,signature:null,
    projectAccess:'unknown',networkAccess:null,inputRefs:[],
    admittedAt:text(task?.status_entered_at)||new Date().toISOString(),
    reason:'stale-running-ambiguous-runtime-state',resolved:false,
  });
  return state;
}
