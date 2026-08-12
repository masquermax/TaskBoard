import { ReadyReason, WorkUnitStatus } from './types.js';

function clone(value){return value == null ? value : JSON.parse(JSON.stringify(value));}

export function migrateReadyReason(value){
  const raw=String(value||'').trim();
  if(raw==='RESOURCE_WAIT')return ReadyReason.WAITING_RESOURCE;
  return Object.values(ReadyReason).includes(raw)?raw:ReadyReason.NEW;
}

function migrateActor(raw, fallbackOwner='root'){
  if(!raw||typeof raw!=='object')return null;
  const actor={...raw,owner:raw.owner||raw.ownerType||fallbackOwner};
  delete actor.ownerType;delete actor.ownerLabel;
  return actor;
}

function migrateWorkUnit(raw){
  if(!raw||typeof raw!=='object')return raw;
  const status=raw.status;
  const inferred=[WorkUnitStatus.RUNNING,WorkUnitStatus.COMPLETED,WorkUnitStatus.RETRY_WAIT,WorkUnitStatus.SUSPENDED].includes(status)?'subagent':null;
  const unit={...raw,owner:raw.owner??raw.ownerType??inferred};
  delete unit.ownerType;delete unit.ownerLabel;
  return unit;
}

export function migrateExecutionState(value){
  if(!value||typeof value!=='object')return value??null;
  const state=clone(value);
  const snapshot=state.snapshot;
  if(snapshot&&typeof snapshot==='object'){
    if(!snapshot.actor&&snapshot.root)snapshot.actor=migrateActor(snapshot.root,'root');
    else if(snapshot.actor)snapshot.actor=migrateActor(snapshot.actor,'root');
    delete snapshot.root;
    if(snapshot.stage?.workUnits) snapshot.stage.workUnits=snapshot.stage.workUnits.map(migrateWorkUnit);
    if(Array.isArray(snapshot.completedWorkUnits))snapshot.completedWorkUnits=snapshot.completedWorkUnits.map(migrateWorkUnit);
  }
  return state;
}
