function clone(value) { return JSON.parse(JSON.stringify(value)); }
function clean(value) { return String(value ?? '').trim(); }

export function createRequirementSource({ taskId, instruction, createdAt = null, sequence = 1 } = {}) {
  const id = clean(taskId);
  if (!id) throw new Error('TASK_CONTRACT_TASK_ID_REQUIRED');
  const text = String(instruction ?? '');
  const ordinal = String(Math.max(1, Number(sequence) || 1)).padStart(4, '0');
  return {
    id: `REQ-${id}-${ordinal}`,
    type: 'task_instruction',
    text,
    created_at: createdAt || null,
  };
}

function canonicalGoalObligation({ taskId, requirementRefs = [] } = {}) {
  const id = clean(taskId);
  if (!id) throw new Error('TASK_CONTRACT_TASK_ID_REQUIRED');
  const refs = clone(Array.isArray(requirementRefs) ? requirementRefs : []);
  if (!refs.length) throw new Error('TASK_CONTRACT_REQUIREMENT_REF_REQUIRED');
  return {
    id: `OBL-${id}-GOAL`,
    certification: 'supported',
    requirement_refs: refs,
    criterion: { mode:'outcome', acceptedOutcomes:['succeeded'] },
  };
}

function ensureCanonicalGoalObligation(contract, taskId) {
  const next = clone(contract);
  if (Array.isArray(next.obligations) && next.obligations.length) return next;
  next.obligations = [canonicalGoalObligation({ taskId, requirementRefs:next.requirement_refs })];
  return next;
}

export function createTaskContractSkeleton({ taskId, requirementSource, createdAt = null } = {}) {
  const id = clean(taskId);
  if (!id) throw new Error('TASK_CONTRACT_TASK_ID_REQUIRED');
  if (!requirementSource?.id) throw new Error('TASK_CONTRACT_REQUIREMENT_SOURCE_REQUIRED');
  const text = String(requirementSource.text ?? '');
  const requirementRefs = [{ source_id: requirementSource.id, start: 0, end: text.length }];
  return {
    id: `TC-${id}`,
    revision: 1,
    requirement_refs: requirementRefs,
    authority: {},
    obligations: [canonicalGoalObligation({ taskId:id, requirementRefs })],
    constraints: [],
    created_at: createdAt || requirementSource.created_at || null,
  };
}

export function createInitialTaskContractState({ taskId, instruction, createdAt = null } = {}) {
  const requirementSource = createRequirementSource({ taskId, instruction, createdAt });
  const taskContract = createTaskContractSkeleton({ taskId, requirementSource, createdAt });
  return {
    requirement_sources: [requirementSource],
    task_contract: taskContract,
  };
}

export function bootstrapTaskContractState(task) {
  if (!task || typeof task !== 'object') throw new Error('TASK_CONTRACT_TASK_REQUIRED');
  const existingSources = Array.isArray(task.requirement_sources) ? clone(task.requirement_sources) : [];
  const existingContract = task.task_contract && typeof task.task_contract === 'object' ? clone(task.task_contract) : null;
  if (existingSources.length && existingContract) {
    return { requirement_sources: existingSources, task_contract: ensureCanonicalGoalObligation(existingContract,task.id) };
  }
  return createInitialTaskContractState({
    taskId: task.id,
    instruction: task.instruction,
    createdAt: task.created_at || null,
  });
}

export function hydrateRequirementSources(values = []) {
  return clone(Array.isArray(values) ? values : []).map(source => ({
    id: source.id,
    type: source.type,
    text: source.text,
    createdAt: source.created_at ?? null,
  }));
}

export function hydrateTaskContract(value = null) {
  if (!value || typeof value !== 'object') return null;
  return {
    id: value.id,
    revision: value.revision,
    requirementRefs: clone(Array.isArray(value.requirement_refs) ? value.requirement_refs : []).map(ref => ({
      sourceId: ref.source_id,
      start: ref.start,
      end: ref.end,
    })),
    authority: clone(value.authority || {}),
    obligations: clone(Array.isArray(value.obligations) ? value.obligations : []),
    constraints: clone(Array.isArray(value.constraints) ? value.constraints : []),
    createdAt: value.created_at ?? null,
  };
}
