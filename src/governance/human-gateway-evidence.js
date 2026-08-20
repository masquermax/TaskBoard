function text(value){return String(value==null?'':value).trim();}

export function humanGatewayEvidenceId(gatewayOrId){
  const id=text(typeof gatewayOrId==='object'?gatewayOrId?.id:gatewayOrId);
  return id?`E-HUMAN-${id}`:'';
}

/**
 * Human Gateway is transport only. Root receives the resolved answer in its
 * trigger context and decides whether that source fact is relevant enough to
 * cite. Runtime must not turn every answer into durable Evidence automatically.
 *
 * This compatibility boundary remains until RootRuntime stops calling it; it is
 * intentionally semantics-free.
 */
export function humanGatewayTransitionCandidate(decision={}){
  return decision;
}
