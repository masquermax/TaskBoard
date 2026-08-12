import { ClaimLevel, EvidenceStrength, EvidenceSourceType } from './analysis-contract.js';
import { normalizeGapResolutions, normalizeCertifiedState } from './certified-state.js';

function text(value){return String(value==null?'':value).trim();}
function mapById(items){return new Map((Array.isArray(items)?items:[]).map(item=>[text(item?.id),item]).filter(([id])=>id));}
function directEvidenceForClaim(claim,evidenceById){return (Array.isArray(claim?.evidenceIds)?claim.evidenceIds:[]).map(id=>evidenceById.get(text(id))).filter(e=>e?.strength===EvidenceStrength.DIRECT);}

/**
 * Select only claims where deterministic provenance checks are insufficient.
 * A model turn exists only when the deterministic source verifier explicitly
 * marks the raw source as requiring semantic interpretation.
 */
export function semanticProofCandidates(decision={},sourceVerifications=[],currentState=null,humanGatewayHistory=[]){
  const current=normalizeCertifiedState(currentState).current;
  const evidenceById=mapById([...(current.evidence||[]),...(Array.isArray(decision.evidence)?decision.evidence:[])]);
  const verificationById=mapById(sourceVerifications);
  const gateways=new Map((Array.isArray(humanGatewayHistory)?humanGatewayHistory:[]).filter(g=>g?.status==='RESOLVED'&&text(g?.id)).map(g=>[text(g.id),g]));
  const traceFor=e=>{
    const live=verificationById.get(text(e?.id))||{};
    const durable=e?._sourceTrace&&typeof e._sourceTrace==='object'?e._sourceTrace:{};
    const merged={ ...durable, ...live };
    if(!text(merged.context)&&text(merged.gatewayId)){
      const gateway=gateways.get(text(merged.gatewayId));
      if(gateway){
        merged.context=[text(gateway?.question),text(gateway?.answer)].filter(Boolean).join('\n');
        if(!text(merged.targetGapId))merged.targetGapId=text(gateway?.targetGapId??gateway?.target_gap_id)||null;
      }
    }
    return merged;
  };
  const gapById=mapById(current.gaps);
  const out=[];
  for(const claim of Array.isArray(decision.claims)?decision.claims:[]){
    if(claim?.level!==ClaimLevel.CONFIRMED||!text(claim?.id)||!text(claim?.statement))continue;
    const direct=directEvidenceForClaim(claim,evidenceById);
    if(!direct.length)continue;
    const needsRawSemantic = direct.some(e=>traceFor(e)?.needsSemantic===true);
    const citesGatewayHuman = direct.some(e=>e?.sourceType===EvidenceSourceType.HUMAN && text(traceFor(e)?.gatewayId));
    if(!needsRawSemantic && !citesGatewayHuman)continue;
    out.push({
      id:text(claim.id),
      targetId:text(claim.id),
      candidateType:'claim',
      statement:text(claim.statement),
      scope:claim.scope,
      coverage:claim.coverage,
      evidence:direct.map(e=>{
        const verification=traceFor(e);
        return {
          id:text(e.id),
          sourceType:e.sourceType,
          coverage:e.coverage,
          locator:text(e.locator),
          observation:text(e.observation),
          ...(text(verification.gatewayId)?{gatewayId:text(verification.gatewayId)}:{}),
          ...(text(verification.targetGapId)?{targetGapId:text(verification.targetGapId)}:{}),
          ...(text(verification.context)?{sourceContext:text(verification.context)}:{}),
        };
      }),
      hops:Array.isArray(claim.hops)?claim.hops:[],
    });
  }
  for(const resolution of normalizeGapResolutions(decision?.gapResolutions)){
    const gapId=text(resolution?.gapId);
    if(!gapId)continue;
    const direct=(Array.isArray(resolution?.evidenceIds)?resolution.evidenceIds:[])
      .map(id=>evidenceById.get(text(id)))
      .filter(e=>e?.strength===EvidenceStrength.DIRECT);
    const gatewayHuman=direct.filter(e=>e?.sourceType===EvidenceSourceType.HUMAN && text(traceFor(e)?.gatewayId));
    if(!gatewayHuman.length)continue;
    const boundGatewayHuman=gatewayHuman.filter(e=>text(traceFor(e)?.targetGapId)===gapId);
    const proofEvidence=boundGatewayHuman.length?boundGatewayHuman:gatewayHuman;
    const gap=gapById.get(gapId)||null;
    out.push({
      id:`gap_resolution:${gapId}`,
      targetId:gapId,
      candidateType:'gap_resolution',
      statement:text(resolution?.reason)||`Resolve Gap ${gapId}`,
      gapQuestion:text(gap?.question),
      gapKind:gap?.kind||null,
      blocking:gap?.blocking===true,
      provenanceConflict:boundGatewayHuman.length===0,
      evidence:proofEvidence.map(e=>{
        const verification=traceFor(e);
        return {
          id:text(e.id),
          sourceType:e.sourceType,
          coverage:e.coverage,
          locator:text(e.locator),
          observation:text(e.observation),
          gatewayId:text(verification.gatewayId),
          targetGapId:text(verification.targetGapId)||null,
          ...(text(verification.context)?{sourceContext:text(verification.context)}:{}),
        };
      }),
      hops:[],
    });
  }
  return out;
}

/**
 * Validator semantic capability. It receives only claims whose cited raw source
 * explicitly requires semantic interpretation, plus the exact traceable source
 * observations already normalized by SourceTraceVerifier.
 * It never owns planning, investigation, lifecycle or History persistence.
 */
export class SemanticProofVerifier{
  constructor({executor,modelRouter}={}){this.executor=executor;this.modelRouter=modelRouter;}

  available(){return typeof this.executor?.runValidator==='function';}

  async review({task,decision,policyContext=null,sourceVerifications=[],humanGatewayHistory=[],currentState=null,onProgress=null,onExecutionStarted=null,signal=null}={}){
    const candidates=semanticProofCandidates(decision,sourceVerifications,currentState,humanGatewayHistory);
    if(!candidates.length)return{checked:false,reviews:[],actions:[]};
    const deterministicReviews=candidates.filter(candidate=>candidate?.provenanceConflict===true).map(candidate=>({
      id:candidate.id,targetId:candidate.targetId||candidate.id,candidateType:candidate.candidateType||'claim',verdict:'overreach',
      reason:'该 Human Evidence 来自另一个 Gateway/Gap，或缺少可验证的 targetGapId；一个 Gateway 的回答不能用于关闭未绑定的 Gap。',
    }));
    const modelCandidates=candidates.filter(candidate=>candidate?.provenanceConflict!==true).map(({provenanceConflict:_internal,...candidate})=>candidate);
    if(!modelCandidates.length)return{checked:true,reviews:deterministicReviews,actions:[]};
    if(!this.available()){
      return{
        checked:true,
        reviews:[...deterministicReviews,...modelCandidates.map(candidate=>({id:candidate.id,targetId:candidate.targetId||candidate.id,candidateType:candidate.candidateType||'claim',verdict:'overreach',reason:'当前 Executor 未提供该原始来源所需的独立语义认证能力；不能仅依赖 Root/Subagent 自己的解释。'}))],
        actions:[{action:'SEMANTIC_VALIDATOR_UNAVAILABLE',target:modelCandidates.map(x=>x.id).join(',')}],
      };
    }
    await this.modelRouter?.prepare?.({role:'validator',task});
    onProgress?.({summary:'Validator 正在认证',detail:`正在针对 ${modelCandidates.length} 项需要语义解释的原始证据核对当前证明关系；不会重新搜索整个项目。`});
    const response=await this.executor.runValidator({
      task,
      candidates:modelCandidates,
      policyContext,
      humanGatewayHistory,
      modelPolicy:this.modelRouter?.route?.({role:'validator',task})||null,
      onProgress,
      onExecutionStarted,
      signal,
    });
    const byId=new Map((Array.isArray(response?.reviews)?response.reviews:[]).map(item=>[text(item?.id),item]));
    const modelReviews=modelCandidates.map(candidate=>{
      const item=byId.get(candidate.id);
      const verdict=item?.verdict==='supported'?'supported':'overreach';
      return{id:candidate.id,targetId:candidate.targetId||candidate.id,candidateType:candidate.candidateType||'claim',verdict,reason:text(item?.reason)||'Validator 未返回可验证的支持结论，按未认证处理。'};
    });
    const reviews=candidates.map(candidate=>deterministicReviews.find(item=>item.id===candidate.id)||modelReviews.find(item=>item.id===candidate.id)).filter(Boolean);
    return{checked:true,reviews,actions:[]};
  }
}
