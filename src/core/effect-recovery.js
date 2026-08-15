import { workMayMutate } from './work-capability.js';

function clone(value){return value==null?value:JSON.parse(JSON.stringify(value));}
function text(value){return String(value==null?'':value).trim();}
function stateObject(value){return value&&typeof value==='object'?clone(value):{};}

export function unresolvedEffectAttempts(executionState){
  const attempts=executionState?.recovery?.effectAttempts;
  return (Array.isArray(attempts)?attempts:[]).filter(item=>item&&item.resolved!==true&&text(item.id)).map(clone);
}

export function hasUnresolvedEffectRecovery(executionState){
  return unresolvedEffectAttempts(executionState).length>0;
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
    inputRefs:[],
    admittedAt:text(task?.status_entered_at)||new Date().toISOString(),
    reason:'stale-running-recovery',
    resolved:false,
  };
}

/**
 * Reconstruct only the minimum safety fact needed at a process boundary.
 * Existing durable recovery facts win. A clearly Root/Validator or read-only
 * snapshot may resume; a missing/ambiguous snapshot cannot prove that an old
 * effect-capable executor never gained control.
 */
export function recoverStaleEffectState(task){
  let state=stateObject(task?.executionState);
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
  if((owner==='root'||owner==='validator'||running.length>0))return state;
  // A stale RUNNING row with a snapshot that proves no current actor/work item is
  // not evidence of an effect. Anything else remains conservative UNKNOWN.
  if(!snapshot?.actor&&!snapshot?.stage)return addUnresolvedEffectAttempt(state,{
    id:`recovered:${text(task?.id)||'task'}:ambiguous`,workUnitId:null,signature:null,
    projectAccess:'unknown',networkAccess:null,inputRefs:[],
    admittedAt:text(task?.status_entered_at)||new Date().toISOString(),
    reason:'stale-running-ambiguous-runtime-state',resolved:false,
  });
  return state;
}
