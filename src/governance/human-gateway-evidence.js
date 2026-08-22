function text(value){return String(value==null?'':value).trim();}

export function humanGatewayEvidenceId(gatewayOrId){
  const id=text(typeof gatewayOrId==='object'?gatewayOrId?.id:gatewayOrId);
  return id?`E-HUMAN-${id}`:'';
}
