const SAFE_REASONING_RANK = Object.freeze({ low:0, medium:1, high:2 });

function reasoningBand(value) {
  const raw=String(value||'').trim().toLowerCase();
  if (['tiny','minimal','low'].includes(raw)) return 'low';
  if (['balanced','medium'].includes(raw)) return 'medium';
  if (['deep','high'].includes(raw)) return 'high';
  return null;
}

function chooseMinimumSufficientEffort(efforts, targetBand) {
  const targetRank=SAFE_REASONING_RANK[targetBand];
  if (!Number.isInteger(targetRank)) return null;
  const candidates=(Array.isArray(efforts)?efforts:[]).map(item=>({
    value:item?.value||null,
    band:reasoningBand(item?.value),
  })).filter(item=>item.value&&item.band);
  const sufficient=candidates
    .filter(item=>SAFE_REASONING_RANK[item.band]>=targetRank)
    .sort((a,b)=>SAFE_REASONING_RANK[a.band]-SAFE_REASONING_RANK[b.band]);
  return sufficient[0]?.value||null;
}

function taskComplexity(task) {
  const instruction = String(task?.instruction || '');
  const title = String(task?.title || '');
  const attachments = Array.isArray(task?.attachments) ? task.attachments.length : 0;
  const scopes = Array.isArray(task?.projectScopes) ? task.projectScopes.length : 0;
  const references = Array.isArray(task?.references) ? task.references.length : 0;
  let score = 0;
  if ((title.length + instruction.length) > 240) score += 1;
  if ((title.length + instruction.length) > 700) score += 1;
  if (attachments > 0) score += 1;
  if (scopes > 0) score += 1;
  if (references > 0) score += 1;
  if (/架构|重构|迁移|安全|并发|性能|复杂|综合|全量|完整|端到端|root cause|architecture|migration|security|performance/i.test(`${title} ${instruction}`)) score += 1;
  return score;
}

function isRetrievalAnalysis(task) {
  const value = `${task?.title || ''}\n${task?.instruction || ''}`;
  const hasSourceContext = (Array.isArray(task?.attachments) && task.attachments.length > 0) || (Array.isArray(task?.projectScopes) && task.projectScopes.length > 0);
  const asksAnalysis = /分析|核对|审查|根据附件|根据项目|需求|查找|定位|review|analy[sz]e|inspect/i.test(value);
  const asksDeepDesign = /架构设计|重构|迁移|安全审计|性能优化|并发设计|端到端重构|architecture design|migration|security audit/i.test(value);
  return hasSourceContext && asksAnalysis && !asksDeepDesign;
}

function configuredModel(snapshot) {
  const value=String(snapshot?.defaults?.model||'').trim();
  return value||null;
}

function taskContext(task) {
  const cwd = (task?.projectScopes || []).map(scope => scope?.path).find(Boolean) || null;
  return cwd ? { cwd } : null;
}

function workText(work) {
  return [work?.title,work?.goal,work?.expectedOutput,work?.stopCondition]
    .map(value=>String(value||'').trim()).filter(Boolean).join('\n');
}

function isFiniteReadOnlyWork(work) {
  if (!work || String(work?.projectAccess||'none').toLowerCase() !== 'read') return false;
  return Boolean(String(work?.goal||'').trim() && String(work?.expectedOutput||'').trim() && String(work?.stopCondition||'').trim());
}

function isBroadProjectWork(work) {
  const refs=Array.isArray(work?.inputRefs)?work.inputRefs.map(value=>String(value||'').trim()).filter(Boolean):[];
  if(!refs.some(ref=>ref.startsWith('project:')))return false;
  const value=workText(work);
  // A natural-language stopCondition does not make an explicitly broad
  // repository investigation lightweight. These are routing hints only: they
  // prevent an efficient downgrade; they do not create Work/Authority truth.
  return /审计|全链路|关键链路|全量|全仓|整个项目|跨实现|跨配置|跨运行时|跨验证|跨模块|跨文件|audit\b|repository[- ]wide|cross[- ](?:module|file|runtime|implementation)/i.test(value);
}

function isDeepWork(value) {
  return /架构|重构|迁移|安全审计|性能优化|并发设计|根因|全量|端到端|复杂|architecture|refactor|migration|security audit|performance optimization|root cause|end[- ]to[- ]end|complex/i.test(String(value||''));
}

function requiredModelTier(role, task, work) {
  if (role === 'validator') return 'balanced';
  if (role === 'subagent') {
    const local=workText(work);
    if (isFiniteReadOnlyWork(work) && !isDeepWork(local) && !isBroadProjectWork(work)) return 'efficient';
    return 'balanced';
  }
  const value=`${task?.title||''}\n${task?.instruction||''}`;
  if (taskComplexity(task)>=4 || isDeepWork(value)) return 'frontier';
  return 'balanced';
}

function requiredReasoningBand(role,task,work) {
  if (role === 'subagent') return isFiniteReadOnlyWork(work) && !isDeepWork(workText(work)) && !isBroadProjectWork(work) ? 'low' : 'medium';
  if (isRetrievalAnalysis(task)) return 'medium';
  if (role==='validator') return 'medium';
  const value=`${task?.title||''}\n${task?.instruction||''}`;
  if (taskComplexity(task)>=4 || isDeepWork(value)) return 'high';
  return 'medium';
}

function modelMetadataText(model) {
  let specialty='';
  try { specialty=typeof model?.modelSpecialty==='string' ? model.modelSpecialty : JSON.stringify(model?.modelSpecialty||''); }
  catch { specialty=''; }
  return `${model?.displayName||''}\n${model?.description||''}\n${specialty}`.toLowerCase();
}

function inferredModelTier(model) {
  const value=modelMetadataText(model);
  // Catalog metadata is evidence; model ids are deliberately excluded. A custom
  // provider with opaque ids can still participate, while unknown descriptions
  // safely fall back to the configured model.
  if (/frontier|flagship|strongest capability|hardest|most complex|complex reasoning|deep reasoning|advanced reasoning|long[- ]running|research|agentic|highest quality|maximum quality|difficult tasks/.test(value)) return 'frontier';
  if (/balanced|general[- ]purpose|general purpose|everyday|daily work|all[- ]around|all around|reliable default|default choice|standard coding|versatile/.test(value)) return 'balanced';
  if (/fast|efficient|affordable|low[- ]latency|low latency|high[- ]throughput|high throughput|routine|repetitive|straightforward|lightweight|cost[- ]effective|cost effective/.test(value)) return 'efficient';
  return null;
}

function priorityValue(model) {
  const value=Number(model?.priority);
  return Number.isFinite(value)?value:Number.MAX_SAFE_INTEGER;
}

function chooseModelForTier(models, requiredTier, configured) {
  const available=(Array.isArray(models)?models:[]).filter(model=>model?.id&&!model.hidden);
  const tiered=available.map(model=>({model,tier:inferredModelTier(model)})).filter(item=>item.tier);
  const acceptable = requiredTier==='efficient' ? ['efficient','balanced','frontier']
    : requiredTier==='balanced' ? ['balanced','frontier']
      : ['frontier'];
  for (const tier of acceptable) {
    const matches=tiered.filter(item=>item.tier===tier).map(item=>item.model)
      .sort((a,b)=>{
        const configuredDelta=(a.id===configured?0:1)-(b.id===configured?0:1);
        return configuredDelta || priorityValue(a)-priorityValue(b) || String(a.id).localeCompare(String(b.id));
      });
    if (matches.length) return {model:matches[0],tier};
  }
  return null;
}

export class ModelRouter {
  constructor({ capabilityProvider = null } = {}) {
    this.capabilityProvider = capabilityProvider;
    this.prepared = new Map();
  }

  release(taskId) { if (taskId) this.prepared.delete(taskId); }

  async prepare({ task } = {}) {
    if (!this.capabilityProvider?.discover) return null;
    let snapshot = null;
    try { snapshot = await this.capabilityProvider.discover({ context:taskContext(task) }); }
    catch { snapshot = this.capabilityProvider.snapshot?.() || null; }
    if (task?.id) this.prepared.set(task.id, snapshot);
    return snapshot;
  }

  route({ role, task, work = null }) {
    const snapshot = (task?.id && this.prepared.get(task.id)) || this.capabilityProvider?.snapshot?.() || null;
    const configured=configuredModel(snapshot);
    const requiredTier=requiredModelTier(role,task,work);
    const policy = {
      quality: requiredTier==='frontier' ? 'quality' : 'balanced',
      model: null,
      configuredDefaultModel: configured,
      reasoningEffort: null,
      capabilityLevel: snapshot?.discoveryLevel || 'basic',
      routeReason: 'executor-default',
    };

    // Unknown or task-context-mismatched capability must never be guessed.
    if (snapshot?.routingSafe === false) return policy;

    // config/read is trusted even without a model catalog. This is the fail-safe
    // path when metadata cannot prove that another model is sufficient.
    if (configured) {
      policy.model=configured;
      policy.routeReason='configured-model';
    }

    const selection=chooseModelForTier(snapshot?.models,requiredTier,configured);
    const selectedModel=selection?.model || (snapshot?.models||[]).find(model=>model.id===configured) || null;
    if (!selectedModel) return policy;
    policy.model=selectedModel.id;

    const efforts = Array.isArray(selectedModel.reasoningEfforts) ? selectedModel.reasoningEfforts : [];
    const targetBand=requiredReasoningBand(role,task,work);
    const chosen=chooseMinimumSufficientEffort(efforts,targetBand);
    if (chosen) policy.reasoningEffort=chosen;

    if (selection) {
      policy.routeReason=`minimum-sufficient-model-${requiredTier}`;
      return policy;
    }
    if (!efforts.length) return { ...policy, routeReason:'known-model-default-effort' };
    const retrieval=isRetrievalAnalysis(task);
    return {
      ...policy,
      routeReason: chosen ? (retrieval?'minimum-sufficient-retrieval':`minimum-sufficient-${targetBand}`) : 'known-model-default-effort',
    };
  }
}