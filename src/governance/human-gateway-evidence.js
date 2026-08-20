function text(value){return String(value==null?'':value).trim();}

export function humanGatewayEvidenceId(gatewayOrId){
  const id=text(typeof gatewayOrId==='object'?gatewayOrId?.id:gatewayOrId);
  return id?`E-HUMAN-${id}`:'';
}

export function humanGatewayEvidence(gateway){
  const id=text(gateway?.id);
  const answer=text(gateway?.answer);
  if(!id||gateway?.status!=='RESOLVED'||!answer)return null;
  return {
    id:humanGatewayEvidenceId(id),
    strength:'direct',
    kind:'fact',
    sourceType:'human',
    coverage:'system',
    statement:answer,
    basis:`Human Gateway ${id}`,
    locator:`Human Gateway ${id}`,
    observation:answer,
  };
}

/**
 * Human Gateway transports a source fact only. A resolved answer does not prove
 * that the target Gap is resolved; Root is the sole owner of that semantic
 * judgment and must emit gapResolutions[] explicitly when the answer is enough.
 */
export function humanGatewayTransitionCandidate(decision={},humanGatewayHistory=[]){
  const evidence=(Array.isArray(humanGatewayHistory)?humanGatewayHistory:[])
    .filter(gateway=>gateway?.status==='RESOLVED'&&text(gateway?.id)&&text(gateway?.answer))
    .map(humanGatewayEvidence)
    .filter(Boolean);
  const byId=new Map();
  for(const item of [...evidence,...(Array.isArray(decision?.evidence)?decision.evidence:[])]){
    const id=text(item?.id);if(id&&!byId.has(id))byId.set(id,item);
  }
  return {...decision,evidence:[...byId.values()]};
}
