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

export function humanGatewayTransitionCandidate(decision={},humanGatewayHistory=[],currentState=null,{includeGapResolution=true}={}){
  const currentGaps=new Map((Array.isArray(currentState?.current?.gaps)?currentState.current.gaps:[])
    .map(gap=>[text(gap?.id),gap]).filter(([id])=>id));
  const resolved=(Array.isArray(humanGatewayHistory)?humanGatewayHistory:[])
    .filter(gateway=>gateway?.status==='RESOLVED'&&text(gateway?.id)&&text(gateway?.answer));
  const evidence=[];
  const resolutions=(Array.isArray(decision?.gapResolutions)?decision.gapResolutions:[])
    .map(item=>({...item,evidenceIds:[...(Array.isArray(item?.evidenceIds)?item.evidenceIds:[])]}));

  for(const gateway of resolved){
    const source=humanGatewayEvidence(gateway);
    if(source)evidence.push(source);
    const gapId=text(gateway?.targetGapId??gateway?.target_gap_id);
    if(!includeGapResolution||!source||!gapId||!currentGaps.has(gapId))continue;
    const existing=resolutions.find(item=>text(item?.gapId)===gapId);
    if(existing){
      existing.evidenceIds=[...new Set([...(existing.evidenceIds||[]).map(text).filter(Boolean),source.id])];
    }else{
      resolutions.push({
        gapId,
        reason:`Human Gateway ${text(gateway.id)} 已回答该阻塞问题；该回答是否足以闭合 Gap 由 Validator 独立认证。`,
        evidenceIds:[source.id],
      });
    }
  }

  const byId=new Map();
  for(const item of [...evidence,...(Array.isArray(decision?.evidence)?decision.evidence:[])]){
    const id=text(item?.id);if(id&&!byId.has(id))byId.set(id,item);
  }
  return {...decision,evidence:[...byId.values()],gapResolutions:resolutions};
}
