function text(value){return String(value==null?'':value).trim();}

/**
 * Stable provenance id only. This helper does not create, admit, certify or
 * persist Evidence. Root must explicitly propose Human Evidence and Validator
 * still verifies its observation against the resolved Gateway answer.
 */
export function humanGatewayEvidenceId(gatewayOrId){
  const id=text(typeof gatewayOrId==='object'?gatewayOrId?.id:gatewayOrId);
  return id?`E-HUMAN-${id}`:'';
}
