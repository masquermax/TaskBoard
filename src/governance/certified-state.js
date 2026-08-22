import { ClaimLevel, normalizeAnalysisFields } from './analysis-contract.js';

function clone(value){return JSON.parse(JSON.stringify(value));}
function text(value){return String(value==null?'':value).trim();}
function uniqueStrings(values){return[...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];}
function stable(value){return JSON.stringify(value);}
function same(a,b){return stable(a)===stable(b);}
function byId(items=[]){return new Map((Array.isArray(items)?items:[]).map(item=>[text(item?.id),item]).filter(([id])=>id));}
function pad(value){return String(value).padStart(4,'0');}

export function emptyCertifiedState(){return{version:0,current:{...normalizeAnalysisFields({resultMode:'analysis'}),resultMode:'analysis'},turns:[]};}

export function normalizeGapResolutions(value){return(Array.isArray(value)?value:[]).map(item=>({gapId:text(item?.gapId),reason:text(item?.reason),evidenceIds:uniqueStrings(item?.evidenceIds)})).filter(item=>item.gapId&&item.reason);}

export function normalizeCertifiedState(value){
  if(!value||typeof value!=='object')return emptyCertifiedState();
  const version=Math.max(0,Number(value.version)||0),normalized=normalizeAnalysisFields(value.current||{});
  return{version,current:{...normalized,resultMode:'analysis',recommendations:[],steps:[]},turns:Array.isArray(value.turns)?value.turns.filter(Boolean).map(clone):[]};
}

export function hasCertifiedKnowledge(state){const current=normalizeCertifiedState(state).current;return['evidence','claims','gaps'].some(key=>Array.isArray(current[key])&&current[key].length>0);}
export function knowledgeKeysFromState(state){const current=normalizeCertifiedState(state).current,keys=[];for(const claim of current.claims||[])if(claim?.level===ClaimLevel.CONFIRMED&&text(claim?.id)&&text(claim?.statement))keys.push(`claim:${text(claim.id)}:${text(claim.statement)}`);for(const gap of current.gaps||[])if(text(gap?.id)&&text(gap?.question))keys.push(`gap:${text(gap.id)}:${text(gap.question)}|${text(gap.reason)}`);return new Set(keys);}

function changedWithNewEvidence(previous,next){const oldRefs=new Set(uniqueStrings(previous?.evidenceIds));return uniqueStrings(next?.evidenceIds).some(id=>!oldRefs.has(id));}
function mergeById(target,incoming,{kind,issues,delta,immutable=false,requiresNewEvidence=false}={}){
  const map=byId(target);
  for(const raw of Array.isArray(incoming)?incoming:[]){
    const id=text(raw?.id);if(!id)continue;const item=clone(raw),previous=map.get(id);
    if(!previous){target.push(item);map.set(id,item);delta.push(item);continue;}
    if(same(previous,item))continue;
    if(immutable){issues.push({code:`${kind.toUpperCase()}_ID_REDEFINED`,target:id,reason:`${kind} ${id} 已进入认证状态；同一 id 不能静默改写，新的来源必须使用新的 id。`});continue;}
    if(requiresNewEvidence&&!changedWithNewEvidence(previous,item)){issues.push({code:`${kind.toUpperCase()}_REVISION_REQUIRES_NEW_EVIDENCE`,target:id,reason:`${kind} ${id} 已进入认证状态；修改旧认知必须带来新的证据引用。`});continue;}
    const index=target.findIndex(value=>text(value?.id)===id);target[index]=item;map.set(id,item);delta.push(item);
  }
}

export function applyCertifiedDelta(state,decision,{triggerRefs=[],committedAt=new Date().toISOString()}={}){
  const base=normalizeCertifiedState(state),current=clone(base.current),candidate=normalizeAnalysisFields(decision),issues=[],delta={evidence:[],claims:[],gaps:[],gapResolutions:[],recommendations:[],steps:[]};
  mergeById(current.evidence,candidate.evidence,{kind:'evidence',issues,delta:delta.evidence,immutable:true});
  mergeById(current.claims,candidate.claims,{kind:'claim',issues,delta:delta.claims,requiresNewEvidence:true});
  mergeById(current.gaps,candidate.gaps,{kind:'gap',issues,delta:delta.gaps,requiresNewEvidence:true});

  const evidenceMap=byId(current.evidence),gapMap=byId(current.gaps);
  for(const resolution of normalizeGapResolutions(decision?.gapResolutions)){
    const previous=gapMap.get(resolution.gapId);
    if(!previous){issues.push({code:'GAP_RESOLUTION_UNKNOWN',target:resolution.gapId,reason:`待闭合 Gap ${resolution.gapId} 不在当前认证状态中。`});continue;}
    if(!resolution.evidenceIds.length||resolution.evidenceIds.some(id=>!evidenceMap.has(id))){issues.push({code:'GAP_RESOLUTION_REQUIRES_EVIDENCE',target:resolution.gapId,reason:`闭合 Gap ${resolution.gapId} 必须引用当前认证状态中存在的证据。`});continue;}
    if(!resolution.evidenceIds.some(id=>evidenceMap.get(id)?.strength==='direct')){issues.push({code:'GAP_RESOLUTION_REQUIRES_DIRECT_EVIDENCE',target:resolution.gapId,reason:`闭合 Gap ${resolution.gapId} 至少需要一条 DIRECT Evidence；间接线索只能缩小不确定性，不能删除已认证 Gap。`});continue;}
    const index=current.gaps.findIndex(item=>text(item?.id)===resolution.gapId);if(index>=0)current.gaps.splice(index,1);gapMap.delete(resolution.gapId);delta.gapResolutions.push(clone(resolution));
  }

  current.recommendations=[];current.steps=[];
  const changed=Object.values(delta).some(items=>Array.isArray(items)&&items.length>0);if(!changed)return{state:base,current:base.current,delta,turnNode:null,issues};
  const resultVersion=base.version+1,turnNode={id:`TURN-${pad(resultVersion)}`,baseVersion:base.version,triggerRefs:uniqueStrings(triggerRefs),delta:clone(delta),resultVersion,committedAt},nextState={version:resultVersion,current,turns:[...base.turns,turnNode]};
  return{state:nextState,current,delta,turnNode,issues};
}

export function decisionFromCertifiedState(state,control={}){
  const normalized=normalizeCertifiedState(state);
  return{kind:control.kind||'complete',summary:text(control.summary),finalResult:null,resultMode:'analysis',evidence:clone(normalized.current.evidence||[]),claims:clone(normalized.current.claims||[]),gaps:clone(normalized.current.gaps||[]),recommendations:Array.isArray(control.recommendations)?clone(control.recommendations):[],steps:Array.isArray(control.steps)?clone(control.steps):[],gateway:control.gateway||null,delegations:Array.isArray(control.delegations)?clone(control.delegations):[],gapResolutions:[]};
}
