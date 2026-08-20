function clone(value){return JSON.parse(JSON.stringify(value));}
function text(value){return String(value==null?'':value).trim();}

export const FidelityCertification=Object.freeze({SUPPORTED:'supported',UNRESOLVED:'unresolved',UNSUPPORTED:'unsupported'});
function normalizeRef(ref={}){const sourceId=text(ref.sourceId??ref.source_id);const start=Number(ref.start),end=Number(ref.end);return{sourceId,start,end};}
export function createAuthoritySemanticCandidate({id,key,value,requirementRefs=[]}={}){const candidateId=text(id),semanticKey=text(key);if(!candidateId)throw new Error('TASK_CONTRACT_CANDIDATE_ID_REQUIRED');if(!semanticKey)throw new Error('TASK_CONTRACT_SEMANTIC_KEY_REQUIRED');return{id:candidateId,key:semanticKey,value:clone(value),requirementRefs:(Array.isArray(requirementRefs)?requirementRefs:[]).map(normalizeRef)};}
function governedTaskContract(task){return task?.taskContract??task?.task_contract??null;}
function governedRequirementRefs(contract){const values=contract?.requirementRefs??contract?.requirement_refs??[];return(Array.isArray(values)?values:[]).map(normalizeRef);}
export function authoritySemanticCandidatesForWork(task={},workUnits=[]){const contract=governedTaskContract(task);if(!contract)return[];const requirementRefs=governedRequirementRefs(contract);if(!requirementRefs.length)return[];const authority=contract.authority&&typeof contract.authority==='object'?contract.authority:{};const revision=Math.max(1,Number(contract.revision)||1),contractId=text(contract.id)||text(task?.id)||'task',units=Array.isArray(workUnits)?workUnits:[],out=[];const needsProjectWrite=units.some(unit=>text(unit?.projectAccess).toLowerCase()==='write');const needsNetwork=units.some(unit=>unit?.networkAccess===true);if(needsProjectWrite&&!Object.prototype.hasOwnProperty.call(authority,'projectWrite'))out.push(createAuthoritySemanticCandidate({id:`AUTH:${contractId}:r${revision}:projectWrite`,key:'projectWrite',value:true,requirementRefs}));if(needsNetwork&&!Object.prototype.hasOwnProperty.call(authority,'networkAccess'))out.push(createAuthoritySemanticCandidate({id:`AUTH:${contractId}:r${revision}:networkAccess`,key:'networkAccess',value:true,requirementRefs}));return out;}
export function resolveRequirementRefs(requirementSources=[],requirementRefs=[]){const sources=new Map((Array.isArray(requirementSources)?requirementSources:[]).map(source=>[text(source?.id),source]).filter(([id])=>id));const excerpts=[],errors=[];for(const ref of Array.isArray(requirementRefs)?requirementRefs:[]){const normalized=normalizeRef(ref),source=sources.get(normalized.sourceId),sourceText=String(source?.text??'');if(!source){errors.push({ref:normalized,reason:'requirement_source_not_found'});continue;}if(!Number.isInteger(normalized.start)||!Number.isInteger(normalized.end)||normalized.start<0||normalized.end<=normalized.start||normalized.end>sourceText.length){errors.push({ref:normalized,reason:'requirement_range_invalid'});continue;}excerpts.push({...normalized,text:sourceText.slice(normalized.start,normalized.end)});}if(!excerpts.length&&!errors.length)errors.push({ref:null,reason:'requirement_refs_required'});return{valid:errors.length===0,excerpts,errors};}

function stripQuotedMaterial(value){
  return text(value)
    .replace(/```[\s\S]*?```/g,' ')
    .replace(/`[^`\n]*`/g,' ')
    .replace(/“[^”]*”|‘[^’]*’|「[^」]*」|『[^』]*』/g,' ')
    .replace(/"[^"\n]*"|'[^'\n]*'/g,' ');
}
function authorityClauses(value){return stripQuotedMaterial(value).split(/[，,。；;！？!?\n]+/).map(text).filter(Boolean);}
function metaOnlyClause(value){const source=text(value);return /(?:示例|例子|引用|原文|错误信息|报错|提示词|字符串|文案|这句话|这段话|以下内容|下面内容)/i.test(source)||/^(?:请|帮我)?\s*(?:分析|解释|说明|评估|审查|检查)\s*(?:为什么|这|以下|下面|上述|原文|示例|例子)/i.test(source);}
function mutationDenied(value){return /(?:不|不要|不得|无需|不需要|不用|不必|禁止|不可|只读|仅查看|仅检查|只分析|仅分析|只解释|仅解释|只说明|仅说明)\s*(?:实际)?\s*(?:进行)?\s*(?:修改|修复|开发|实现|部署|安装|删除|重构|提交|打包|发布|升级|改造|写代码|写入|变更|执行)?/i.test(text(value));}
function networkDenied(value){return /(?:不|不要|不得|无需|不需要|不用|不必|禁止|不可)\s*(?:进行)?\s*(?:联网|访问(?:网络|互联网)|上网|使用网络|网络访问|搜索网页|搜索网络)|(?:只|仅)\s*(?:看|查|检查|分析|读取)?\s*(?:本地|项目|附件)/i.test(text(value));}
function explicitProjectWrite(value){return authorityClauses(value).some(source=>!metaOnlyClause(source)&&!mutationDenied(source)&&/(?:请|帮我|直接|现在|开始|需要|要求|把|给我|完成)?\s*(?:开发|修复|修改|新增|删除|重构|部署|安装|提交|发布|升级|改造|写代码|写入|实现(?:功能|需求|逻辑|代码|方案|改造))/i.test(source));}
function explicitNetworkAccess(value){return authorityClauses(value).some(source=>!metaOnlyClause(source)&&!networkDenied(source)&&/(?:请|帮我|直接|现在|开始|需要|允许|要求)?\s*(?:联网|访问(?:网络|互联网)|上网|使用网络|网络访问|搜索网页|搜索网络)|\b(?:search the web|use the network|internet access|online lookup)\b/i.test(source));}
function classifyAuthority(candidate,requirementText){if(candidate.value!==true)return{certification:FidelityCertification.UNRESOLVED,reason:'Only explicit positive authority can expand Runtime capability.'};if(candidate.key==='projectWrite')return explicitProjectWrite(requirementText)?{certification:FidelityCertification.SUPPORTED,reason:'The cited human Requirement explicitly requests project mutation.'}:{certification:FidelityCertification.UNRESOLVED,reason:'The cited human Requirement does not explicitly grant project mutation.'};if(candidate.key==='networkAccess')return explicitNetworkAccess(requirementText)?{certification:FidelityCertification.SUPPORTED,reason:'The cited human Requirement explicitly requests network access.'}:{certification:FidelityCertification.UNRESOLVED,reason:'The cited human Requirement does not explicitly grant network access.'};return{certification:FidelityCertification.UNRESOLVED,reason:`Unknown authority key: ${candidate.key}.`};}

/**
 * Task authority is a deterministic projection of the human-owned Requirement.
 * No model is allowed to grant capability. Root may request work; Runtime either
 * finds an explicit grant in the cited Requirement or fails closed.
 */
export class TaskContractFidelityVerifier{
  constructor(_options={}){}
  available(){return true;}
  async review({task,candidates=[]}={}){
    const sources=task?.requirementSources??task?.requirement_sources??[],reviews=[];
    for(const raw of Array.isArray(candidates)?candidates:[]){
      const candidate=createAuthoritySemanticCandidate(raw),resolved=resolveRequirementRefs(sources,candidate.requirementRefs);
      if(!resolved.valid){reviews.push({...candidate,certification:FidelityCertification.UNRESOLVED,reason:`Requirement provenance is not valid: ${resolved.errors.map(error=>error.reason).join(', ')}`});continue;}
      const requirementText=resolved.excerpts.map(excerpt=>excerpt.text).join('\n');
      reviews.push({...candidate,...classifyAuthority(candidate,requirementText)});
    }
    return{checked:reviews.length>0,reviews};
  }
}

export function applyAuthorityFidelity(taskContract,candidates=[],reviews=[]){if(!taskContract||typeof taskContract!=='object')throw new Error('TASK_CONTRACT_REQUIRED');const next=clone(taskContract),byId=new Map((Array.isArray(reviews)?reviews:[]).map(review=>[text(review?.id),review]).filter(([id])=>id));next.authority={...(next.authority||{})};for(const raw of Array.isArray(candidates)?candidates:[]){const candidate=createAuthoritySemanticCandidate(raw),review=byId.get(candidate.id),certification=Object.values(FidelityCertification).includes(review?.certification)?review.certification:FidelityCertification.UNRESOLVED;next.authority[candidate.key]={value:clone(candidate.value),certification,requirement_refs:candidate.requirementRefs.map(ref=>({source_id:ref.sourceId,start:ref.start,end:ref.end}))};}return next;}
