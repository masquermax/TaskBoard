function text(value){return String(value==null?'':value).trim();}
function unique(values){return [...new Set((Array.isArray(values)?values:[]).map(text).filter(Boolean))];}

export function normalizeContributionRefs(values){return unique(values);}

export function availableContributionRefsForTask(task={},analysisState=null){
  const obligations=(task?.taskContract?.obligations||[]).map(item=>text(item?.id)).filter(Boolean).map(id=>`obligation:${id}`);
  const gaps=(analysisState?.current?.gaps||[]).map(item=>text(item?.id)).filter(Boolean).map(id=>`gap:${id}`);
  return unique([...obligations,...gaps]);
}

export function resolveContributionRefs(values,availableRefs=[]){
  const explicit=normalizeContributionRefs(values);
  if(explicit.length)return explicit;
  const available=normalizeContributionRefs(availableRefs);
  const gaps=available.filter(ref=>ref.startsWith('gap:'));
  const obligations=available.filter(ref=>ref.startsWith('obligation:'));
  // Compatibility is safe only when there is no competing governed Gap and the
  // whole Task has exactly one canonical obligation. Once a Gap exists, Root
  // must say explicitly whether Work advances that Gap or an independent obligation.
  if(!gaps.length&&obligations.length===1)return[obligations[0]];
  return[];
}

export function validateContributionRefs(workUnit,availableRefs=[]){
  const available=normalizeContributionRefs(availableRefs);
  if(!available.length)return{refs:normalizeContributionRefs(workUnit?.contributionRefs),issues:[]};
  const refs=resolveContributionRefs(workUnit?.contributionRefs,available);
  const allowed=new Set(available);
  const issues=[];
  if(!refs.length)issues.push('Work Unit 必须明确绑定当前 governed Gap 或 obligation；自然语言 goal 不能代替推进关系。');
  for(const ref of refs)if(!allowed.has(ref))issues.push(`Work Unit 引用了不存在或已失效的 governed contribution：${ref}。`);
  return{refs,issues};
}

export function repeatedContributionRefs(delegations=[],rootInputs=[]){
  const consumed=new Set((Array.isArray(rootInputs)?rootInputs:[]).flatMap(item=>normalizeContributionRefs(item?.workUnit?.contributionRefs)));
  if(!consumed.size)return[];
  return unique((Array.isArray(delegations)?delegations:[]).flatMap(item=>normalizeContributionRefs(item?.contributionRefs)).filter(ref=>consumed.has(ref)));
}

export function hasLocalProgressSignal(rootInputs=[]){
  // A concrete local blocker changes the execution problem even when it is not
  // Task truth and therefore must not be forced into Certified State. Mere prose,
  // uncertainty wording, or a different method name does not buy another Work.
  return (Array.isArray(rootInputs)?rootInputs:[]).some(item=>Boolean(text(item?.blocker)));
}
