import { readFileSync, writeFileSync } from 'node:fs';

const path='src/core/root-runtime.js';
let source=readFileSync(path,'utf8');
let changed=false;
const forbidden=['sourceBackedAnalysis','hasIssuedSourceWork','SOURCE_ANALYSIS_REQUIRES_DELEGATED_EVIDENCE'];
const startMarker="\n      const sourceBackedAnalysis=";
const endMarker="\n\n      let reviewed;";
const start=source.indexOf(startMarker);
if(start>=0){
  if(source.indexOf(startMarker,start+startMarker.length)>=0)throw new Error('PHASE4_PROXY_DUPLICATE:sourceBackedAnalysis');
  const end=source.indexOf(endMarker,start);
  if(end<0)throw new Error('PHASE4_PROXY_END_MISSING:reviewed');
  source=source.slice(0,start)+source.slice(end);
  changed=true;
}
for(const token of forbidden)if(source.includes(token))throw new Error(`PHASE4_PROXY_STILL_PRESENT:${token}`);

const evaluatorGuard="        if(!this.completionEvaluator){const error=new Error('COMPLETION_EVALUATOR_REQUIRED');error.nonRetryable=true;throw error;}";
const availabilityGuard="        if(this.completionAssessmentVerifier?.available?.()===false){const error=new Error('VALIDATOR_UNAVAILABLE: Completion Validator semantic certification is unavailable.');error.nonRetryable=true;throw error;}";
if(!source.includes(availabilityGuard)){
  const index=source.indexOf(evaluatorGuard);
  if(index<0)throw new Error('PHASE4_AVAILABILITY_ANCHOR_MISSING');
  if(source.indexOf(evaluatorGuard,index+evaluatorGuard.length)>=0)throw new Error('PHASE4_AVAILABILITY_ANCHOR_DUPLICATE');
  source=source.slice(0,index)+availabilityGuard+'\n'+source.slice(index);
  changed=true;
}
if(source.indexOf(availabilityGuard)!==source.lastIndexOf(availabilityGuard))throw new Error('PHASE4_AVAILABILITY_GUARD_DUPLICATE');

if(changed){
  writeFileSync(path,source,'utf8');
  console.log('Phase 4 RootRuntime completion availability enforcement applied');
}else{
  console.log('Phase 4 RootRuntime completion availability enforcement already applied');
}
