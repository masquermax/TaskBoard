import { readFileSync, writeFileSync } from 'node:fs';

const path='src/core/root-runtime.js';
let source=readFileSync(path,'utf8');
const forbidden=['sourceBackedAnalysis','hasIssuedSourceWork','SOURCE_ANALYSIS_REQUIRES_DELEGATED_EVIDENCE'];
const startMarker="\n      const sourceBackedAnalysis=";
const endMarker="\n\n      let reviewed;";
const start=source.indexOf(startMarker);
if(start>=0){
  if(source.indexOf(startMarker,start+startMarker.length)>=0)throw new Error('PHASE4_PROXY_DUPLICATE:sourceBackedAnalysis');
  const end=source.indexOf(endMarker,start);
  if(end<0)throw new Error('PHASE4_PROXY_END_MISSING:reviewed');
  source=source.slice(0,start)+source.slice(end);
  for(const token of forbidden)if(source.includes(token))throw new Error(`PHASE4_PROXY_STILL_PRESENT:${token}`);
  writeFileSync(path,source,'utf8');
  console.log('Phase 4 legacy completion work-occurrence proxy removed');
}else{
  for(const token of forbidden)if(source.includes(token))throw new Error(`PHASE4_PROXY_PARTIAL_STATE:${token}`);
  console.log('Phase 4 legacy completion work-occurrence proxy already absent');
}
