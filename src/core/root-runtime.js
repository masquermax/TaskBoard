import { WorkUnitStatus } from './types.js';
import { MAX_TOTAL_ATTEMPTS, capacityRetryDelayMs, capacityWaitingInstruction, classifyRetry, isCapacityUnavailable, isInterrupted, retryDelayMs, suspendedInstruction, waitingRetryInstruction } from './retry-policy.js';
import { normalizeAnalysisFields } from '../governance/analysis-contract.js';
import { canonicalAnalysisSummary, renderAnalysisResult } from '../governance/analysis-validator.js';
import { applyCertifiedDelta, decisionFromCertifiedState, deriveHistoryFromTurn, knowledgeKeysFromState, normalizeCertifiedState } from '../governance/certified-state.js';
import { taskInputRefs } from './task-input-scope.js';
import { humanGatewayTransitionCandidate } from '../governance/human-gateway-evidence.js';
import { applyAuthorityFidelity, defaultAuthoritySemanticCandidates } from '../governance/task-contract-fidelity.js';
import { recordTaskDiagnostic } from './runtime-diagnostic.js';

function nowIso() { return new Date().toISOString(); }
function clone(value) { return JSON.parse(JSON.stringify(value)); }

function snapshotWorkUnit(unit, stageId = null) {
  return {
    id: unit.id,
    stageId,
    title: unit.title,
    projectAccess: unit.projectAccess || 'none',
    networkAccess: unit.networkAccess === true,
    status: unit.status,
    detail: unit.detail,
    updatedAt: unit.updatedAt,
    failureCount: unit.failureCount || 0,
    nextRetryAt: unit.nextRetryAt || null,
    canRetry: unit.status === WorkUnitStatus.SUSPENDED,
    owner: unit.owner ?? ([WorkUnitStatus.RUNNING,WorkUnitStatus.COMPLETED,WorkUnitStatus.RETRY_WAIT,WorkUnitStatus.SUSPENDED].includes(unit.status) ? 'subagent' : null),
  };
}

function workSemanticSignature(item) {
  const normalize = value => String(value || '').trim().replace(/\s+/g,' ');
  return JSON.stringify({
    title:normalize(item?.title),
    goal:normalize(item?.goal),
    expectedOutput:normalize(item?.expectedOutput),
    stopCondition:normalize(item?.stopCondition),
    projectAccess:normalize(item?.projectAccess || 'none'),
    networkAccess:item?.networkAccess===true,
    skillId:normalize(item?.skillId),
    dependsOn:[...(Array.isArray(item?.dependsOn)?item.dependsOn:[])].map(normalize).filter(Boolean).sort(),
    inputRefs:[...(Array.isArray(item?.inputRefs)?item.inputRefs:[])].map(normalize).filter(Boolean).sort(),
  });
}

function normalizeDecision(decision) {
  const analysis = normalizeAnalysisFields(decision);
  return {
    kind: decision?.kind || null,
    summary: String(decision?.summary || ''),
    stageResult: decision?.stageResult == null ? null : String(decision.stageResult),
    finalResult: decision?.finalResult == null ? null : String(decision.finalResult),
    ...analysis,
    delegations: Array.isArray(decision?.delegations) ? decision.delegations : [],
    gateway: decision?.gateway || null,
    gapResolutions: Array.isArray(decision?.gapResolutions) ? decision.gapResolutions : [],
  };
}

function composeExecutionResult(decision) {
  return decision.finalResult?.trim() || decision.summary?.trim() || '任务已完成。';
}

function rootInputEvidence(rootInputs = []) {
  const out=[];
  const seen=new Set();
  for(const item of Array.isArray(rootInputs)?rootInputs:[]) {
    for(const evidence of Array.isArray(item?.evidence)?item.evidence:[]) {
      const id=String(evidence?.id||'').trim();
      if(!id||seen.has(id))continue;
      seen.add(id);
      out.push(evidence);
    }
  }
  return out;
}

function humanHistoryForTriggerRefs(history = [], triggerRefs = []) {
  const ids=new Set((Array.isArray(triggerRefs)?triggerRefs:[])
    .map(ref=>String(ref||'').trim())
    .filter(ref=>ref.startsWith('human:'))
    .map(ref=>ref.slice('human:'.length))
    .filter(Boolean));
  if(!ids.size)return[];
  return (Array.isArray(history)?history:[]).filter(item=>ids.has(String(item?.id||'').trim()));
}

function consumeHumanTriggerRefs(session, triggerRefs = []) {
  for(const ref of Array.isArray(triggerRefs)?triggerRefs:[]){
    const value=String(ref||'').trim();
    if(value.startsWith('human:')&&value.length>'human:'.length)session.consumedHumanGatewayIds.add(value.slice('human:'.length));
  }
}

function validationError(violations = []) {
  const summary = violations.slice(0,6).map(v => `${v.ruleId}:${v.target}:${v.reason}`).join(' | ');
  const error = new Error(`GOVERNANCE_VALIDATION_FAILED${summary ? `: ${summary}` : ''}`);
  error.nonRetryable = true;
  error.governanceViolations = violations;
  return error;
}

export function validateDelegationPlan(delegations, { knownWorkIds = [], availableInputRefs = null } = {}) {
  const raw = Array.isArray(delegations) ? delegations : [];
  const issues = [];
  const selected = raw.map((item, index) => {
    const title=String(item?.title || '').trim();
    const goal=String(item?.goal || '').trim();
    return {
      ...item,
      id:String(item?.id || '').trim(),
      title,
      goal,
      expectedOutput:String(item?.expectedOutput || '').trim(),
      stopCondition:String(item?.stopCondition || '').trim(),
      projectAccess:String(item?.projectAccess || 'none').trim().toLowerCase(),
      networkAccess:item?.networkAccess===true,
      skillId:item?.skillId == null || String(item.skillId).trim()==='' ? null : String(item.skillId).trim(),
      dependsOn:Array.isArray(item?.dependsOn) ? [...new Set(item.dependsOn.map(value => String(value).trim()).filter(Boolean))] : [],
      inputRefs:Array.isArray(item?.inputRefs) ? [...new Set(item.inputRefs.map(value => String(value).trim()).filter(Boolean))] : [],
      __index:index,
    };
  });
  const knownIds = new Set((Array.isArray(knownWorkIds) ? knownWorkIds : []).map(value => String(value).trim()).filter(Boolean));
  const allowedInputs = Array.isArray(availableInputRefs) ? new Set(availableInputRefs.map(value=>String(value).trim()).filter(Boolean)) : null;
  const ids = new Set();
  for (const item of selected) {
    if (!item.id) issues.push(`第 ${item.__index + 1} 项工作缺少 id。`);
    else if (ids.has(item.id) || knownIds.has(item.id)) issues.push(`工作 id 重复：${item.id}。`);
    else ids.add(item.id);
    if (!item.title) issues.push(`工作 ${item.id || item.__index + 1} 缺少 title。`);
    if (!item.goal) issues.push(`工作 ${item.id || item.__index + 1} 缺少有限 goal。`);
    if (!item.expectedOutput) issues.push(`工作 ${item.id || item.__index + 1} 缺少 expectedOutput。`);
    if (!item.stopCondition) issues.push(`工作 ${item.id || item.__index + 1} 缺少 stopCondition。`);
    if (!['none','read','write'].includes(item.projectAccess)) issues.push(`工作 ${item.id || item.__index + 1} 的 projectAccess 必须是 none、read 或 write。`);
    if (allowedInputs) for (const ref of item.inputRefs) if (!allowedInputs.has(ref)) issues.push(`工作 ${item.id || item.__index + 1} 引用了不存在的 Task Input：${ref}。`);
    const hasProjectInput=item.inputRefs.some(ref=>ref.startsWith('project:'));
    if (item.projectAccess !== 'none' && !hasProjectInput) issues.push(`工作 ${item.id || item.__index + 1} 申请 Project 访问时必须通过 inputRefs 显式选择至少一个项目。`);
    if (item.projectAccess === 'none' && hasProjectInput) issues.push(`工作 ${item.id || item.__index + 1} 选择了项目输入，但 projectAccess=none。`);
  }
  for (const item of selected) {
    if (!item.id) continue;
    if (item.dependsOn.includes(item.id)) issues.push(`工作 ${item.id} 不能依赖自身。`);
    for (const dep of item.dependsOn) if (!ids.has(dep) && !knownIds.has(dep)) issues.push(`工作 ${item.id} 依赖不存在的工作：${dep}。`);
  }
  if (!issues.length && selected.length) {
    const indegree = new Map(selected.map(item => [item.id, 0]));
    const outgoing = new Map(selected.map(item => [item.id, []]));
    for (const item of selected) for (const dep of item.dependsOn) {
      if (!ids.has(dep)) continue; // existing Work Units cannot depend on this new batch, so they cannot create a new cycle
      indegree.set(item.id, (indegree.get(item.id) || 0) + 1);
      outgoing.get(dep).push(item.id);
    }
    const queue = selected.filter(item => indegree.get(item.id) === 0).map(item => item.id);
    let visited = 0;
    while (queue.length) {
      const id = queue.shift(); visited += 1;
      for (const next of outgoing.get(id) || []) {
        const value = indegree.get(next) - 1; indegree.set(next, value);
        if (value === 0) queue.push(next);
      }
    }
    if (visited !== selected.length) issues.push('工作依赖形成循环，当前阶段无法安全推进。');
  }
  return {
    valid:issues.length === 0,
    issues:[...new Set(issues)],
    delegations:selected.map(({__index,...item}) => item),
  };
}

export class RootRuntime {
  constructor({ executor, modelRouter, subagentRuntime, governanceCompiler = null, validatorRuntime = null, taskContractFidelityVerifier = null, maxConcurrentSubagents = 3, capabilityLimits = null, retryDelaysMs = null }) {
    this.executor = executor;
    this.modelRouter = modelRouter;
    this.subagentRuntime = subagentRuntime;
    this.governanceCompiler = governanceCompiler;
    this.validatorRuntime = validatorRuntime;
    this.taskContractFidelityVerifier = taskContractFidelityVerifier;
    this.maxConcurrentSubagents = Math.max(1, Math.min(5, Number(maxConcurrentSubagents) || 1));
    this.capabilityLimits = typeof capabilityLimits === 'function' ? capabilityLimits : null;
    this.retryDelaysMs = retryDelaysMs;
    this.sessions = new Map();
  }

  setConcurrency(value) { this.maxConcurrentSubagents = Math.max(1, Math.min(5, Number(value) || 1)); return this.maxConcurrentSubagents; }

  effectiveConcurrency() {
    const limit = Number(this.capabilityLimits?.()?.taskMaxSubagents);
    return Number.isInteger(limit) && limit > 0 ? Math.min(this.maxConcurrentSubagents, limit) : this.maxConcurrentSubagents;
  }

  getSession(taskId) { return this.sessions.get(taskId) || null; }
  isQuiescent(taskId) {
    const s = this.sessions.get(taskId);
    return !s || (s.runningControllers.size === 0 && s.runningPromises.size === 0 && !s.rootController);
  }

  snapshot(taskId) {
    const s = this.sessions.get(taskId);
    if (!s) return null;
    return this.makeSnapshot(s);
  }

  makeSnapshot(session) {
    return clone({
      taskId: session.taskId,
      actor: session.actor ? { ...session.actor, owner:session.actor.owner||'root' } : null,
      stage: session.currentStage ? {
        id: session.currentStage.id,
        title: session.currentStage.title,
        startedAt: session.currentStage.startedAt,
        workUnits: session.currentStage.workUnits.map(unit => snapshotWorkUnit(unit, session.currentStage.id)),
      } : null,
      completedWorkUnits: session.completedWorkUnits.map(unit => ({ ...unit })),
      updatedAt: session.updatedAt,
    });
  }

  emit(session, callbacks) {
    session.updatedAt = nowIso();
    callbacks.onProgress?.(this.makeSnapshot(session));
  }

  commitProgress(session, callbacks, commits = []) {
    for (const raw of Array.isArray(commits) ? commits : []) {
      const title = String(raw?.title || '').trim();
      const detail = String(raw?.detail || '').trim();
      if (!title || !detail) continue;
      const key = `${title}\n${detail}`;
      if (session.committedProgressKeys.has(key)) continue;
      // A History boundary is committed only after Task Core/persistence accepts
      // it. If persistence throws, do not mark this boundary as committed in
      // memory; the execution/recovery path must be able to try it again.
      callbacks.onProgressCommit?.({ title, detail, completedAt:nowIso() });
      session.committedProgressKeys.add(key);
      session.lastCommittedStageResult = detail;
    }
  }

  requestQuiesce(taskId) {
    const session = this.sessions.get(taskId);
    if (!session) return false;
    session.cancelRequested = true;
    if (session.rootController) session.rootController.abort();
    for (const controller of session.runningControllers.values()) controller.abort();
    return true;
  }

  interruptForShutdown(taskId) {
    const session = this.sessions.get(taskId);
    if (!session) return false;
    // Process shutdown is not a user cancellation. Abort in-flight execution so
    // the Scheduler can become idle, but leave lifecycle state untouched; the
    // next process start will recover a stale RUNNING Task from its last
    // valuable stage boundary.
    if (session.rootController) session.rootController.abort();
    for (const controller of session.runningControllers.values()) controller.abort();
    return true;
  }

  retryWorkUnit(taskId, workUnitId) {
    const session = this.sessions.get(taskId);
    const unit = session?.currentStage?.workUnits.find(x => x.id === workUnitId);
    if (!unit || unit.status !== WorkUnitStatus.SUSPENDED) return false;
    unit.failureCount = 0;
    unit.nextRetryAt = Date.now();
    unit.status = WorkUnitStatus.WAITING_RESOURCE;
    unit.detail = '已收到重新尝试请求，将从第 1/5 次开始重新执行。';
    unit.updatedAt = nowIso();
    session.updatedAt = unit.updatedAt;
    return true;
  }

  discardSession(taskId) {
    this.sessions.delete(taskId);
    this.modelRouter.release?.(taskId);
  }

  cleanupTaskWorkspace(taskId) {
    return this.executor.cleanupTaskWorkspace?.(taskId) ?? false;
  }

  async ensureTaskAuthority(task,session,callbacks){const candidates=defaultAuthoritySemanticCandidates(task);if(!candidates.length)return task;session.actor={title:'Requirement Authority 认证',status:WorkUnitStatus.WAITING_RESOURCE,detail:'等待 Validator 核对 Requirement Authority。',updatedAt:nowIso(),owner:'validator'};this.emit(session,callbacks);let reviews=[];if(this.taskContractFidelityVerifier){const result=await this.taskContractFidelityVerifier.review({task,candidates,policyContext:this.governanceCompiler?.compileForRole?.(task,'validator')||session.policyContext,onExecutionStarted:()=>{session.actor.status=WorkUnitStatus.RUNNING;callbacks.onExecutionStarted?.({role:'validator'});this.emit(session,callbacks);},onProgress:p=>{session.actor.detail=p?.detail||p?.summary||session.actor.detail;this.emit(session,callbacks);}});reviews=Array.isArray(result?.reviews)?result.reviews:[];}const nextContract=applyAuthorityFidelity(task.taskContract,candidates,reviews);callbacks.onTaskContractAuthority?.(nextContract.authority);const next={...task,taskContract:nextContract};session.policyContext=this.governanceCompiler?.compileForTask?.(next)||session.policyContext;return next;}

  createSession(task) {
    const restoredAnalysisState = normalizeCertifiedState(task.analysisState);
    const durableWorkReceipts=(Array.isArray(task.workReceipts)?task.workReceipts:[]).filter(receipt=>receipt?.signature&&receipt?.workUnit&&receipt?.result);
    const pendingWorkResults=durableWorkReceipts.filter(receipt=>!receipt.consumed_at).map(receipt=>({...clone(receipt.result),workUnit:clone(receipt.workUnit),persistedReceipt:true}));
    const session = {
      taskId: task.id,
      round: 0,
      // Certified Work Unit results waiting for the next Root synthesis. Results
      // already absorbed into a certified Root result are removed to keep context bounded.
      subagentResults: pendingWorkResults,
      currentStage: null,
      // Runtime-only execution visibility. These completed Work Units remain visible
      // while the Task is still open, but never become certified knowledge/History.
      completedWorkUnits: durableWorkReceipts.map(receipt=>({ id:receipt.id, stageId:null, title:receipt.workUnit.title||receipt.id, projectAccess:receipt.workUnit.projectAccess||'none', networkAccess:receipt.workUnit.networkAccess===true, status:WorkUnitStatus.COMPLETED, detail:receipt.result?.result||'工作已完成。', updatedAt:receipt.completed_at||nowIso(), failureCount:0, nextRetryAt:null, canRetry:false, owner:'subagent' })),
      cancelRequested: false,
      rootController: null,
      runningControllers: new Map(),
      runningPromises: new Map(),
      policyContext: this.governanceCompiler?.compileForTask?.(task) || null,
      planningFeedback: null,
      planningRepairCount: 0,
      planningTriggerRefs: [],
      committedProgressKeys: new Set(),
      lastCommittedStageResult: task.last_stage_result || null,
      analysisState: restoredAnalysisState,
      certifiedContext: restoredAnalysisState.current,
      certifiedKnowledgeKeys: knowledgeKeysFromState(restoredAnalysisState),
      consumedHumanGatewayIds: new Set((restoredAnalysisState.turns||[]).flatMap(turn=>turn?.triggerRefs||[]).map(ref=>String(ref||'')).filter(ref=>ref.startsWith('human:')).map(ref=>ref.slice('human:'.length)).filter(Boolean)),
      // Work Unit identity is semantic, not merely an Agent-provided id. Keeping
      // accepted signatures prevents Root from accidentally re-issuing the same
      // completed/active work under fresh ids instead of making a new Task decision.
      issuedWorkSignatures: new Set(durableWorkReceipts.map(receipt=>String(receipt.signature||'')).filter(Boolean)),
      pendingValidation: null,
      rootTurnCount: 0,
      controlHandoffCount: 0,
      actor: { title: '综合分析', status: WorkUnitStatus.WAITING_RESOURCE, detail: '等待可用 Root 执行资源。', updatedAt: nowIso(), owner:'root' },
      updatedAt: nowIso(),
    };
    this.sessions.set(task.id, session);
    return session;
  }

  async runRootTurn(task, session, callbacks, { humanGatewayHistory = [], validationFeedback = null, previousDecision = null, rootInputs = null, authorityHandoff = false } = {}) {
    if (session.cancelRequested) return { kind: 'cancelled' };
    session.actor = { title:'综合分析', status:WorkUnitStatus.WAITING_RESOURCE, detail:'正在获取可用 Root 执行资源。', updatedAt:nowIso(), owner:'root' };
    this.emit(session, callbacks);
    const controller = new AbortController();
    const deliveredResults = Array.isArray(rootInputs) ? rootInputs : session.subagentResults.slice();
    const activeWork = session.currentStage ? session.currentStage.workUnits.map(unit => ({ id:unit.id, title:unit.title, status:unit.status, projectAccess:unit.projectAccess||'none', networkAccess:unit.networkAccess===true, dependsOn:unit.dependsOn })) : [];
    session.rootController = controller;
    try {
      const runRoot = this.executor.runRoot.bind(this.executor);
      await this.modelRouter.prepare?.({ role:'root', task });
      const decision = normalizeDecision(await runRoot({
        task,
        subagentResults: deliveredResults,
        activeWork,
        humanGatewayHistory,
        modelPolicy: this.modelRouter.route({ role:'root', task }),
        policyContext: this.governanceCompiler?.compileForRole?.(task,'root') || session.policyContext,
        planningFeedback: session.planningFeedback,
        validationFeedback,
        previousDecision,
        authorityHandoff,
        certifiedContext: session.certifiedContext,
        signal: controller.signal,
        onExecutionStarted: () => {
          session.actor.status = WorkUnitStatus.RUNNING;
          session.actor.detail = deliveredResults.length ? '正在消费刚通过认证的局部结果并判断下一步。' : '正在结合任务目标、当前已认证状态与本轮触发信息进行判断。';
          session.actor.updatedAt = nowIso();
          callbacks.onExecutionStarted?.({ role:'root' });
          this.emit(session, callbacks);
        },
        onProgress: progress => {
          session.actor.detail = progress.detail || progress.summary || session.actor.detail;
          session.actor.updatedAt = nowIso();
          this.emit(session, callbacks);
        },
      }));
      session.rootTurnCount += 1;
      session.actor.status = WorkUnitStatus.COMPLETED;
      session.actor.detail = session.policyContext?.taskMode === 'analysis'
        ? '本轮分析已形成候选结果，正在进入 Governance 校验。'
        : (decision.summary || '综合分析已完成。');
      session.actor.updatedAt = nowIso();
      this.emit(session, callbacks);
      return decision;
    } catch (error) {
      if (session.cancelRequested && isInterrupted(error)) return { kind:'cancelled' };
      throw error;
    } finally {
      session.rootController = null;
    }
  }


  async reviewRootDecision(task, session, decision, callbacks, { humanGatewayHistory = [], validatorHumanGatewayHistory = humanGatewayHistory, startAttempt = 1, rootInputs = [], triggerRefs = [], synthesizeHumanGapResolution = true } = {}) {
    if (!this.validatorRuntime) {
      if (decision?.resultMode === 'analysis' || session?.policyContext?.taskMode === 'analysis') {
        const error=new Error('VALIDATOR_RUNTIME_REQUIRED: analysis Candidate cannot bypass Validator ownership.');
        error.nonRetryable=true;
        throw error;
      }
      return { decision, commits:[] };
    }

    let validationAttempt=Math.max(1,Math.min(2,Number(startAttempt)||1));
    const withHumanTransition = candidate => humanGatewayTransitionCandidate(candidate,humanGatewayHistory,session.analysisState,{includeGapResolution:synthesizeHumanGapResolution});
    decision=withHumanTransition(decision);
    let reviewed = this.validatorRuntime.reviewRoot({
      decision,
      policyContext:this.governanceCompiler?.compileForRole?.(task,'validator') || session.policyContext,
      attempt:validationAttempt,
      seenKnowledgeKeys:session.certifiedKnowledgeKeys,
      task,
      humanGatewayHistory,
      currentState:session.analysisState,
      availableEvidence:rootInputEvidence(rootInputs),
    });
    if(reviewed.outcome==='pass') {
      try {
        reviewed = await this.validatorRuntime.semanticReviewRoot?.({reviewed,policyContext:this.governanceCompiler?.compileForRole?.(task,'validator') || session.policyContext,attempt:validationAttempt,seenKnowledgeKeys:session.certifiedKnowledgeKeys,task,humanGatewayHistory:validatorHumanGatewayHistory,currentState:session.analysisState,onProgress:progress=>{session.actor={title:'Validator 认证',status:WorkUnitStatus.RUNNING,detail:progress?.detail||'正在核对需要语义解释的原始证据与当前具体证明关系。',updatedAt:nowIso(),owner:'validator'};this.emit(session,callbacks);},onExecutionStarted:()=>callbacks.onExecutionStarted?.({role:'validator'}),signal:null}) || reviewed;
      } catch (error) {
        if (isCapacityUnavailable(error)) error.pendingRootValidation={phase:'validate',decision:reviewed.decision,validationAttempt,rootInputs,triggerRefs};
        throw error;
      }
    }
    if (reviewed.outcome === 'rework' && validationAttempt < 2) {
      session.actor = { title:'Root 局部修正', status:WorkUnitStatus.WAITING_RESOURCE, detail:'Validator 已给出明确认证问题，等待 Root 对同一候选做一次受限修正。', updatedAt:nowIso(), owner:'root' };
      this.emit(session, callbacks);
      let reworked;
      try {
        reworked = await this.runRootTurn(task, session, callbacks, {
            humanGatewayHistory,
          validationFeedback:reviewed.feedback,
          previousDecision:reviewed.decision,
          rootInputs,
        });
      } catch (error) {
        if (isCapacityUnavailable(error)) {
          error.pendingRootValidation={phase:'rework',decision:reviewed.decision,feedback:reviewed.feedback,validationAttempt:2,rootInputs,triggerRefs};
        }
        throw error;
      }
      if (reworked?.kind === 'cancelled') return { decision:reworked, commits:[] };
      validationAttempt=2;
      reworked=withHumanTransition(reworked);
      reviewed = this.validatorRuntime.reviewRoot({
        decision:reworked,
        policyContext:this.governanceCompiler?.compileForRole?.(task,'validator') || session.policyContext,
        attempt:validationAttempt,
        seenKnowledgeKeys:session.certifiedKnowledgeKeys,
        task,
        humanGatewayHistory,
        currentState:session.analysisState,
        availableEvidence:rootInputEvidence(rootInputs),
      });
      if(reviewed.outcome==='pass') {
        try {
          reviewed = await this.validatorRuntime.semanticReviewRoot?.({reviewed,policyContext:this.governanceCompiler?.compileForRole?.(task,'validator') || session.policyContext,attempt:validationAttempt,seenKnowledgeKeys:session.certifiedKnowledgeKeys,task,humanGatewayHistory:validatorHumanGatewayHistory,currentState:session.analysisState,onProgress:progress=>{session.actor={title:'Validator 认证',status:WorkUnitStatus.RUNNING,detail:progress?.detail||'正在核对需要语义解释的原始证据与当前具体证明关系。',updatedAt:nowIso(),owner:'validator'};this.emit(session,callbacks);},onExecutionStarted:()=>callbacks.onExecutionStarted?.({role:'validator'}),signal:null}) || reviewed;
        } catch (error) {
        if (isCapacityUnavailable(error)) error.pendingRootValidation={phase:'validate',decision:reviewed.decision,validationAttempt,rootInputs,triggerRefs};
          throw error;
        }
      }
    }
    if (reviewed.outcome !== 'pass') throw validationError(reviewed.feedback || []);

    // C-003 + C-005 are realized here as a durable learning boundary:
    // only the certified delta may change Current State, and omission never
    // deletes previously committed knowledge.
    const workTriggerRefs=(Array.isArray(rootInputs)?rootInputs:[]).map(item=>String(item?.delegationId||item?.workUnit?.id||'').trim()).filter(Boolean).map(id=>`work:${id}`);
    const certifiedTriggerRefs=[...new Set([...(Array.isArray(triggerRefs)?triggerRefs:[]),...workTriggerRefs].map(value=>String(value||'').trim()).filter(Boolean))];
    if(!certifiedTriggerRefs.length){
      const error=new Error('ROOT_TURN_WITHOUT_TRIGGER: Current Certified State is context, not a trigger for another Root Turn.');
      error.nonRetryable=true;
      throw error;
    }
    const beforeCertifiedState=session.analysisState;
    const prepared=applyCertifiedDelta(beforeCertifiedState,reviewed.decision,{triggerRefs:certifiedTriggerRefs});
    for(const gateway of Array.isArray(humanGatewayHistory)?humanGatewayHistory:[]){
      const gatewayId=String(gateway?.id||'').trim();
      const targetGapId=String(gateway?.targetGapId??gateway?.target_gap_id??'').trim();
      if(!gatewayId||!targetGapId||gateway?.status!=='RESOLVED')continue;
      const beforeOpen=Boolean(beforeCertifiedState?.current?.gaps?.some?.(gap=>String(gap?.id||'').trim()===targetGapId));
      const afterOpen=Boolean(prepared?.current?.gaps?.some?.(gap=>String(gap?.id||'').trim()===targetGapId));
      recordTaskDiagnostic('human-gap-proof-result',{taskId:task.id,gatewayId,targetGapId,proofAttempted:Boolean(synthesizeHumanGapResolution&&beforeOpen),resolved:beforeOpen&&!afterOpen,gapStillOpen:afterOpen});
    }
    const historyCommit=deriveHistoryFromTurn(prepared.turnNode);
    const workReceiptIds=(Array.isArray(rootInputs)?rootInputs:[]).map(item=>String(item?.delegationId||item?.workUnit?.id||'').trim()).filter(Boolean);
    if(prepared.turnNode){
      const commitPayload={analysisState:prepared.state,turnNode:prepared.turnNode,historyCommit:historyCommit?{...historyCommit,completedAt:prepared.turnNode.committedAt}:null,workReceiptIds};
      if(callbacks.onCertifiedTurn)callbacks.onCertifiedTurn(commitPayload);
      else if(historyCommit)this.commitProgress(session,callbacks,[historyCommit]);
      session.analysisState=prepared.state;
      session.certifiedContext=prepared.state.current;
      session.certifiedKnowledgeKeys=knowledgeKeysFromState(prepared.state);
      if(historyCommit){
        session.lastCommittedStageResult=historyCommit.detail;
        const key=`${historyCommit.title}\n${historyCommit.detail}`;
        session.committedProgressKeys.add(key);
      }
    } else if(workReceiptIds.length) {
      callbacks.onWorkReceiptsConsumed?.(workReceiptIds);
    }
    const blockingGap=prepared.current.gaps?.find?.(gap=>gap?.blocking===true);
    const stateFeedback=(prepared.issues||[]).map(issue=>({ruleId:'C-003',target:issue.target||'state',reason:issue.reason,action:issue.code}));
    const gatewayWithoutBlocker=reviewed.decision?.kind==='human_gateway' && !blockingGap;
    const gatewayGapId=String(reviewed.decision?.gateway?.gapId||'').trim();
    const gatewayGap=(prepared.current.gaps||[]).find(gap=>String(gap?.id||'').trim()===gatewayGapId) || null;
    const normalizeQuestion=value=>String(value||'').trim().replace(/\s+/g,' ');
    const gatewayBindingConflict=reviewed.decision?.kind==='human_gateway' && Boolean(
      !gatewayGapId || !gatewayGap || gatewayGap.blocking!==true || normalizeQuestion(reviewed.decision?.gateway?.question)!==normalizeQuestion(gatewayGap?.question)
    );
    const stateTransitionConflict=(prepared.issues||[]).length>0;
    const requiresRootDecision=Boolean(
      reviewed.requiresRootDecision ||
      (reviewed.decision?.kind==='complete' && (blockingGap || stateTransitionConflict)) ||
      (reviewed.decision?.kind==='delegate' && blockingGap) ||
      gatewayWithoutBlocker ||
      gatewayBindingConflict
    );
    if(blockingGap)stateFeedback.push({ruleId:'C-004',target:'blocking-gap',reason:`当前认证状态仍存在阻塞 Gap：${blockingGap.question}`,action:'HANDOFF_ROOT_CONTROL_DECISION'});
    if(reviewed.decision?.kind==='delegate'&&blockingGap)stateFeedback.push({ruleId:'C-004',target:'blocking-gap-delegation',reason:`当前认证状态仍存在 blocking Gap：${blockingGap.question}。按现行 Contract，Root 只能判断它不再阻塞或请求 Human Gateway，不能再创建调查 Work Unit。`,action:'HANDOFF_ROOT_CONTROL_DECISION'});
    if(stateTransitionConflict)stateFeedback.push({ruleId:'C-003',target:'state-transition',reason:'候选内容与已认证状态的合法状态转换冲突；Root 必须基于保留下来的 Current State 重新决定当前结果。',action:'HANDOFF_ROOT_CONTROL_DECISION'});
    if(gatewayWithoutBlocker)stateFeedback.push({ruleId:'C-004',target:'human-gateway',reason:'当前没有阻塞 Task 的已认证 Gap；Human Gateway 不能仅用于请求采用默认假设，非阻塞未知应保留为 Gap。',action:'HANDOFF_ROOT_CONTROL_DECISION'});
    if(gatewayBindingConflict)stateFeedback.push({ruleId:'C-004',target:'human-gateway-binding',reason:'Human Gateway 必须绑定一个当前已认证的 blocking Gap，且 question 必须与该 Gap 的认证问题一致；context/options 只能解释，不能替换问题语义。',action:'HANDOFF_ROOT_CONTROL_DECISION'});
    return {
      decision:normalizeDecision(reviewed.decision),
      commits:historyCommit?[historyCommit]:[],
      feedback:[...(Array.isArray(reviewed.feedback)?reviewed.feedback:[]),...stateFeedback],
      actions:[...(Array.isArray(reviewed.actions)?reviewed.actions:[]),...(prepared.issues||[]).map(issue=>({action:issue.code,target:issue.target}))],
      requiresRootDecision,
      turnNode:prepared.turnNode,
    };
  }

  buildWorkUnits(stage, delegations) {
    const existingIds = new Set((stage?.workUnits || []).map(unit => unit.id));
    return (Array.isArray(delegations) ? delegations : []).map((d, index) => {
      const id = String(d.id);
      const deps = Array.isArray(d.dependsOn) ? [...new Set(d.dependsOn.map(String))].filter(x => x !== id) : [];
      const waitingOnDependency = deps.some(dep => {
        const prior = stage?.workUnits?.find(unit => unit.id === dep);
        return !prior || prior.status !== WorkUnitStatus.COMPLETED;
      });
      return {
        id,
        title: String(d.title || `工作 ${index + 1}`),
        goal: String(d.goal || ''),
        expectedOutput: String(d.expectedOutput || ''),
        stopCondition: String(d.stopCondition || ''),
        projectAccess: ['read','write'].includes(d.projectAccess) ? d.projectAccess : 'none',
        networkAccess: d.networkAccess === true,
        inputRefs: Array.isArray(d.inputRefs) ? [...d.inputRefs] : [],
        skillId: d.skillId || null,
        dependsOn: deps,
        status: waitingOnDependency ? WorkUnitStatus.WAITING_DEPENDENCY : WorkUnitStatus.WAITING_RESOURCE,
        detail: waitingOnDependency ? '等待前置工作完成后继续。' : '工作已就绪，等待可用 Agent。',
        updatedAt: nowIso(),
        failureCount: 0,
        nextRetryAt: Date.now(),
        result: null,
        owner: null,
      };
    }).filter(unit => !existingIds.has(unit.id));
  }

  createStage(session, delegations) {
    const stage = { id:`stage-${session.round + 1}`, title:'当前工作', startedAt:nowIso(), workUnits:[] };
    stage.workUnits.push(...this.buildWorkUnits(stage, delegations));
    session.currentStage = stage;
    return stage;
  }

  appendToStage(session, delegations) {
    if (!session.currentStage) return this.createStage(session, delegations);
    const additions = this.buildWorkUnits(session.currentStage, delegations);
    session.currentStage.workUnits.push(...additions);
    this.updateWaitingStates(session.currentStage);
    return additions;
  }

  hasUnfinishedWork(session) {
    return Boolean(session.currentStage?.workUnits?.some(unit => unit.status !== WorkUnitStatus.COMPLETED));
  }

  consumeRootInputs(session, rootInputs = []) {
    const ids = new Set((Array.isArray(rootInputs) ? rootInputs : []).map(item => String(item?.delegationId || item?.workUnit?.id || '')).filter(Boolean));
    if (!ids.size) return;
    session.subagentResults = session.subagentResults.filter(item => !ids.has(String(item?.delegationId || item?.workUnit?.id || '')));
  }

  depsCompleted(stage, unit) {
    return unit.dependsOn.every(id => stage.workUnits.find(x => x.id === id)?.status === WorkUnitStatus.COMPLETED);
  }

  hasSuspendedDependency(stage, unit) {
    return unit.dependsOn.some(id => stage.workUnits.find(x => x.id === id)?.status === WorkUnitStatus.SUSPENDED);
  }

  updateWaitingStates(stage) {
    for (const unit of stage.workUnits) {
      if (unit.status !== WorkUnitStatus.WAITING_DEPENDENCY) continue;
      if (this.hasSuspendedDependency(stage, unit)) {
        unit.detail = '前置工作已挂起；等待该工作重新执行成功后继续。';
      } else if (this.depsCompleted(stage, unit)) {
        unit.status = WorkUnitStatus.WAITING_RESOURCE;
        unit.nextRetryAt = Date.now();
        unit.detail = '前置工作已完成，等待可用 Agent。';
        unit.updatedAt = nowIso();
      }
    }
  }

  startSubagent(task, session, unit, callbacks) {
    unit.status = WorkUnitStatus.WAITING_RESOURCE;
    unit.owner = null;
    unit.detail = unit.failureCount ? `正在准备第 ${unit.failureCount + 1}/${MAX_TOTAL_ATTEMPTS} 次尝试。` : '工作已就绪，正在获取可用 Subagent。';
    unit.updatedAt = nowIso();
    const controller = new AbortController();
    session.runningControllers.set(unit.id, controller);
    this.emit(session, callbacks);

    const dependencyResults = unit.dependsOn.map(id => { const dep=session.currentStage?.workUnits.find(x=>x.id===id); return dep?.result ? { id, title:dep.title, result:dep.result } : null; }).filter(Boolean);
    const promise = this.subagentRuntime.run(task, {
      id: unit.id,
      title: unit.title,
      goal: unit.goal,
      expectedOutput: unit.expectedOutput,
      stopCondition: unit.stopCondition,
      projectAccess: unit.projectAccess || 'none',
      networkAccess: unit.networkAccess === true,
      inputRefs: Array.isArray(unit.inputRefs) ? [...unit.inputRefs] : [],
      skillId: unit.skillId,
      dependsOn: unit.dependsOn,
      dependencyResults,
    }, {
      signal: controller.signal,
      policyContext: this.governanceCompiler?.compileForRole?.(task,'subagent',{skillId:unit.skillId,workUnit:unit}) || session.policyContext,
      onExecutionStarted: _meta => {
        unit.status = WorkUnitStatus.RUNNING;
        unit.owner = 'subagent';
        unit.detail = unit.failureCount ? `正在进行第 ${unit.failureCount + 1}/${MAX_TOTAL_ATTEMPTS} 次尝试。` : '正在执行分配的具体工作。';
        unit.updatedAt = nowIso();
        callbacks.onExecutionStarted?.({ role:'subagent', workUnitId:unit.id });
        this.emit(session, callbacks);
      },
      onProgress: progress => {
        unit.owner = 'subagent';
        unit.detail = progress.detail || progress.summary || unit.detail;
        unit.updatedAt = nowIso();
        this.emit(session, callbacks);
      },
    }).then(result => {
      unit.result = result;
      unit.status = WorkUnitStatus.COMPLETED;
      unit.owner = 'subagent';
      unit.detail = result?.result || '工作已完成。';
      unit.updatedAt = nowIso();
      const workUnit={ id:unit.id, title:unit.title, goal:unit.goal, expectedOutput:unit.expectedOutput, stopCondition:unit.stopCondition, projectAccess:unit.projectAccess||'none', networkAccess:unit.networkAccess===true, skillId:unit.skillId, dependsOn:[...(unit.dependsOn||[])], inputRefs:[...(unit.inputRefs||[])] };
      const receipt={id:unit.id,signature:workSemanticSignature(workUnit),workUnit,result:clone(result),completed_at:unit.updatedAt};
      try{callbacks.onWorkReceipt?.(receipt);}catch(error){error.nonRetryable=true;error.workReceiptPersistence=true;throw error;}
      session.subagentResults.push({...result,workUnit});
    }).catch(error => {
      if (session.cancelRequested && isInterrupted(error)) return;
      if (isCapacityUnavailable(error)) {
        const delay = capacityRetryDelayMs(this.retryDelaysMs);
        unit.owner = null;
        unit.status = WorkUnitStatus.WAITING_RESOURCE;
        unit.nextRetryAt = Date.now() + delay;
        unit.detail = capacityWaitingInstruction(error?.message || '');
        unit.updatedAt = nowIso();
        return;
      }
      unit.failureCount += 1;
      unit.owner = 'subagent';
      const policy = classifyRetry(error);
      if (!policy.retryable || unit.failureCount >= MAX_TOTAL_ATTEMPTS) {
        unit.status = WorkUnitStatus.SUSPENDED;
        unit.nextRetryAt = null;
        unit.detail = suspendedInstruction(policy.reason, policy.message, unit.failureCount);
      } else {
        const delay = retryDelayMs(unit.failureCount, this.retryDelaysMs);
        unit.status = WorkUnitStatus.RETRY_WAIT;
        unit.nextRetryAt = Date.now() + delay;
        unit.detail = waitingRetryInstruction(policy.reason, policy.message, unit.failureCount, delay);
      }
      unit.updatedAt = nowIso();
    }).finally(() => {
      session.runningControllers.delete(unit.id);
      session.runningPromises.delete(unit.id);
      this.emit(session, callbacks);
    });
    session.runningPromises.set(unit.id, promise);
    return promise;
  }


  async runStage(task, session, callbacks) {
    const stage = session.currentStage;
    while (true) {
      if (session.cancelRequested) {
        for (const controller of session.runningControllers.values()) controller.abort();
        if (session.runningPromises.size) await Promise.allSettled([...session.runningPromises.values()]);
        return { kind:'cancelled' };
      }

      this.updateWaitingStates(stage);
      const runningCount = stage.workUnits.filter(x => x.status === WorkUnitStatus.RUNNING && x.owner !== 'validator').length;
      const pendingStarts = [...session.runningPromises.keys()].filter(id => {
        const unit=stage.workUnits.find(item => item.id === id);
        return [WorkUnitStatus.WAITING_RESOURCE,WorkUnitStatus.RETRY_WAIT].includes(unit?.status);
      }).length;
      const slots = Math.max(0, this.effectiveConcurrency() - runningCount - pendingStarts);
      const ready = stage.workUnits.filter(unit => [WorkUnitStatus.WAITING_RESOURCE,WorkUnitStatus.RETRY_WAIT].includes(unit.status) && !session.runningPromises.has(unit.id) && (unit.nextRetryAt || 0) <= Date.now());
      const subagentReady = ready.slice(0, slots);
      const started = subagentReady.map(unit => this.startSubagent(task, session, unit, callbacks));

      // A certified Work Unit result is delivered to Root immediately. Independent
      // siblings keep running and newly free Subagent slots are filled above before
      // Root receives control. This removes the old whole-stage barrier.
      if (session.subagentResults.length) {
        return { kind:'work_results_ready', results:session.subagentResults.slice(), snapshot:this.makeSnapshot(session) };
      }

      if (started.length) {
        await Promise.race(started.map(p => p.catch(() => null)));
        continue;
      }

      const runningPromises = [...session.runningPromises.values()];
      if (runningPromises.length) {
        const nextRetryAt = stage.workUnits
          .filter(x => [WorkUnitStatus.WAITING_RESOURCE,WorkUnitStatus.RETRY_WAIT].includes(x.status) && !session.runningPromises.has(x.id) && x.nextRetryAt)
          .map(x => Number(x.nextRetryAt))
          .filter(Number.isFinite)
          .sort((a,b) => a-b)[0];
        const waits = runningPromises.map(promise => promise.catch(() => null));
        if (nextRetryAt) {
          const delay = Math.max(0, nextRetryAt - Date.now());
          waits.push(new Promise(resolveWait => { const timer=setTimeout(resolveWait,delay); timer.unref?.(); }));
        }
        await Promise.race(waits);
        continue;
      }

      if (stage.workUnits.every(x => x.status === WorkUnitStatus.COMPLETED)) {
        const completedUnits = stage.workUnits.map(unit => ({ title:unit.title, detail:unit.detail, completedAt:unit.updatedAt }));
        callbacks.onStageCompleted?.(completedUnits);
        session.completedWorkUnits.push(...stage.workUnits.map(unit => snapshotWorkUnit(unit, stage.id)));
        session.currentStage = null;
        session.round += 1;
        this.emit(session, callbacks);
        return { kind:'stage_complete' };
      }

      const suspended = stage.workUnits.filter(x => x.status === WorkUnitStatus.SUSPENDED);
      if (suspended.length) return { kind:'suspended', reason:`${suspended.length} 项工作已挂起`, snapshot:this.makeSnapshot(session) };

      const future = stage.workUnits
        .filter(x => [WorkUnitStatus.WAITING_RESOURCE,WorkUnitStatus.RETRY_WAIT].includes(x.status) && x.nextRetryAt)
        .map(x => x.nextRetryAt);
      if (future.length) {
        const retrying=stage.workUnits.some(x=>x.status===WorkUnitStatus.RETRY_WAIT&&x.nextRetryAt);
        return { kind:retrying?'retry_wait':'waiting_resource', retryAt:Math.min(...future), snapshot:this.makeSnapshot(session), reason:retrying?'等待自动重试':'等待执行资源恢复' };
      }

      return { kind:'suspended', reason:'当前工作无法继续推进', snapshot:this.makeSnapshot(session) };
    }
  }



  async execute(task, { humanGatewayHistory = [], onProgress = null, onStageCompleted = null, onStageResult = null, onProgressCommit = null, onCertifiedTurn = null, onTaskContractAuthority = null, onWorkReceipt = null, onWorkReceiptsConsumed = null, onExecutionStarted = null } = {}) {
    const session = this.sessions.get(task.id) || this.createSession(task);
    session.cancelRequested = false;
    const callbacks = { onProgress, onStageCompleted, onStageResult, onProgressCommit, onCertifiedTurn, onTaskContractAuthority, onWorkReceipt, onWorkReceiptsConsumed, onExecutionStarted };
    try{task=await this.ensureTaskAuthority(task,session,callbacks);}catch(error){if(isCapacityUnavailable(error)){const delay=capacityRetryDelayMs(this.retryDelaysMs);return{kind:'waiting_resource',retryAt:Date.now()+delay,snapshot:this.makeSnapshot(session),reason:'等待 Requirement Authority Validator 资源恢复'};}throw error;}
    const newlyResolvedHuman=(Array.isArray(humanGatewayHistory)?humanGatewayHistory:[]).filter(g=>g?.status==='RESOLVED'&&String(g?.id||'').trim()&&!session.consumedHumanGatewayIds.has(String(g.id).trim()));
    let invocationTriggerRefs=newlyResolvedHuman.map(g=>`human:${String(g.id).trim()}`);
    if(!invocationTriggerRefs.length){
      const reason=String(task?.ready_reason||'').trim();
      if(session.rootTurnCount===0&&!reason)invocationTriggerRefs=[`task:${task.id}`];
      else if(reason==='NEW')invocationTriggerRefs=[`task:${task.id}`];
      else if(reason==='RETRY_WAIT')invocationTriggerRefs=[`technical:retry:${task.id}`];
      else if(reason==='WAITING_RESOURCE')invocationTriggerRefs=[`technical:resource-resume:${task.id}`];
      else if(reason==='SUSPENDED')invocationTriggerRefs=[`technical:manual-resume:${task.id}`];
      else if(session.rootTurnCount===0)invocationTriggerRefs=[`task:${task.id}`];
    }
    let invocationTriggerConsumed=false;

    const capacityWait = async ({ title, detail, reason }) => {
      const delay = capacityRetryDelayMs(this.retryDelaysMs);
      session.actor = { title, status:WorkUnitStatus.WAITING_RESOURCE, detail, updatedAt:nowIso(), owner:title.includes('Validator')?'validator':'root' };
      this.emit(session, callbacks);
      if (session.runningPromises.size) {
        const timer = new Promise(resolveWait => { const t=setTimeout(resolveWait,delay); t.unref?.(); });
        await Promise.race([...session.runningPromises.values()].map(p=>p.catch(()=>null)).concat(timer));
        return null;
      }
      return { kind:'waiting_resource', retryAt:Date.now()+delay, snapshot:this.makeSnapshot(session), reason };
    };

    // Root owns Task convergence. Runtime therefore has no arbitrary stage/turn
    // count that can force business convergence; concrete contract violations,
    // duplicate work, retry policy and resource state provide the technical bounds.
    while (true) {
      if (session.cancelRequested) return { kind:'cancelled', quiescent:this.isQuiescent(task.id) };

      // Resume a preserved Root/Validator boundary before asking running work for
      // another delivery. Independent Work Units may continue in the background.
      const pendingValidation = session.pendingValidation;
      let stageOutcome = null;
      if (!pendingValidation && session.currentStage) {
        stageOutcome = await this.runStage(task, session, callbacks);
        if (stageOutcome.kind === 'cancelled') return { kind:'cancelled', quiescent:this.isQuiescent(task.id) };
        if (!['stage_complete','work_results_ready'].includes(stageOutcome.kind)) {
          return { ...stageOutcome, quiescent:this.isQuiescent(task.id) };
        }
      }

      let decision;
      let validationStartAttempt = 1;
      let rootInputs = pendingValidation?.rootInputs || session.subagentResults.slice();
      let rootTriggerRefs = Array.isArray(pendingValidation?.triggerRefs) ? [...pendingValidation.triggerRefs] : [];
      session.pendingValidation = null;

      if(rootInputs.length&&!rootTriggerRefs.length)rootTriggerRefs=rootInputs.map(item=>String(item?.delegationId||item?.workUnit?.id||'').trim()).filter(Boolean).map(id=>`work:${id}`);

      if (pendingValidation?.phase === 'validate') {
        decision = pendingValidation.decision;
        validationStartAttempt = pendingValidation.validationAttempt || 1;
        session.actor = { title:'Validator 认证', status:WorkUnitStatus.WAITING_RESOURCE, detail:'Root 候选结果已保留，等待认证资源；已完成的 Root/Subagent 工作不会重跑。', updatedAt:nowIso(), owner:'validator' };
        this.emit(session,callbacks);
      } else if (pendingValidation?.phase === 'rework') {
        validationStartAttempt = pendingValidation.validationAttempt || 2;
        session.actor = { title:'Root 局部修正', status:WorkUnitStatus.WAITING_RESOURCE, detail:'Validator 已给出明确认证反馈，等待 Root 对同一候选结果做一次局部修正。', updatedAt:nowIso(), owner:'root' };
        this.emit(session,callbacks);
        try {
          decision = await this.runRootTurn(task,session,callbacks,{ humanGatewayHistory:humanHistoryForTriggerRefs(humanGatewayHistory,rootTriggerRefs), validationFeedback:pendingValidation.feedback||[], previousDecision:pendingValidation.decision, rootInputs });
        } catch (error) {
          if (isCapacityUnavailable(error)) {
            session.pendingValidation = pendingValidation;
            const outcome = await capacityWait({ title:'Root 局部修正', detail:'局部修正尚未获得 Root 资源；候选结果和 Validator 反馈已保留。', reason:'等待 Root 局部修正资源恢复' });
            if (outcome) return outcome;
            continue;
          }
          throw error;
        }
      } else if (pendingValidation?.phase === 'authority_handoff') {
        // Validator owns certification only. When certified content changes the
        // control implications (for example a blocking Gap remains), control
        // returns to Root instead of Validator silently choosing completion,
        // delegation or Human Gateway. This is a new Root control decision, not
        // another validation rework attempt.
        validationStartAttempt = 1;
        rootInputs = [];
        session.actor = { title:'Root 控制决策', status:WorkUnitStatus.WAITING_RESOURCE, detail:'Validator 已完成内容认证；等待 Root 基于已认证边界决定下一步，不重新调查已认证内容。', updatedAt:nowIso(), owner:'root' };
        this.emit(session,callbacks);
        try {
          decision = await this.runRootTurn(task,session,callbacks,{
            humanGatewayHistory:humanHistoryForTriggerRefs(humanGatewayHistory,rootTriggerRefs),
            validationFeedback:pendingValidation.feedback||[],
            previousDecision:pendingValidation.decision,
            rootInputs:[],
            authorityHandoff:true,
          });
        } catch (error) {
          if (isCapacityUnavailable(error)) {
            session.pendingValidation = pendingValidation;
            const outcome = await capacityWait({ title:'Root 控制决策', detail:'已认证内容和控制权交接信息已保留；等待 Root 资源后继续。', reason:'等待 Root 控制决策资源恢复' });
            if (outcome) return outcome;
            continue;
          }
          throw error;
        }
      } else {
        if(!rootInputs.length){
          if(session.planningFeedback?.length&&session.planningTriggerRefs?.length){
            // Capability-contract repair is a bounded sub-loop of the same Root
            // turn. It reuses the original trigger; it does not manufacture a
            // new business/event trigger merely because the plan was invalid.
            rootTriggerRefs=[...session.planningTriggerRefs];
          }else{
            if(invocationTriggerConsumed||!invocationTriggerRefs.length){
              const error=new Error('ROOT_TURN_WITHOUT_TRIGGER: no Task/Human/Subagent/technical trigger exists for another ordinary Root Turn.');
              error.nonRetryable=true;
              throw error;
            }
            rootTriggerRefs=[...invocationTriggerRefs];
            invocationTriggerConsumed=true;
          }
        }
        try {
          decision = await this.runRootTurn(task, session, callbacks, { humanGatewayHistory:humanHistoryForTriggerRefs(humanGatewayHistory,rootTriggerRefs), rootInputs });
        } catch (error) {
          if (isCapacityUnavailable(error) && (rootInputs.length || session.currentStage)) {
            const outcome = await capacityWait({ title:'Root 综合分析', detail:'已认证的局部结果已保留，等待 Root 资源后继续综合；其他独立 Work Unit 不受影响。', reason:'等待 Root 综合资源恢复' });
            if (outcome) return outcome;
            continue;
          }
          throw error;
        }
      }
      if (decision.kind === 'cancelled') return { kind:'cancelled', quiescent:this.isQuiescent(task.id) };

      const sourceBackedAnalysis=session.policyContext?.taskMode==='analysis'&&Boolean((task.projectScopes||[]).length||(task.attachments||[]).length);
      const hasCertifiedWorkTrigger=(session.analysisState?.turns||[]).some(turn=>(turn?.triggerRefs||[]).some(ref=>String(ref||'').startsWith('work:')));
      const hasIssuedSourceWork=session.issuedWorkSignatures.size>0||session.completedWorkUnits.length>0||rootInputs.length>0||hasCertifiedWorkTrigger;
      if(sourceBackedAnalysis&&decision.kind==='complete'&&!hasIssuedSourceWork){
        const issue='SOURCE_ANALYSIS_REQUIRES_DELEGATED_EVIDENCE: Root does not own Project/Attachment investigation; source-backed analysis must first obtain bounded Work Unit evidence.';
        session.planningRepairCount+=1;
        session.planningFeedback=[issue];
        session.planningTriggerRefs=[...rootTriggerRefs];
        session.actor={title:'Completion Contract 校验',status:WorkUnitStatus.COMPLETED,detail:'Root 试图在没有 delegated source evidence 时完成 source-backed analysis；已返回同一 Root 触发做一次受限规划修正。',updatedAt:nowIso(),owner:'root'};
        this.emit(session,callbacks);
        if(session.planningRepairCount>=2){const error=new Error(`ROOT_INVALID_COMPLETION_PLAN: ${issue}`);error.nonRetryable=true;throw error;}
        continue;
      }

      let reviewed;
      try {
        reviewed = await this.reviewRootDecision(task, session, decision, callbacks, { humanGatewayHistory:humanHistoryForTriggerRefs(humanGatewayHistory,rootTriggerRefs), validatorHumanGatewayHistory:humanGatewayHistory, startAttempt:validationStartAttempt, rootInputs, triggerRefs:rootTriggerRefs, synthesizeHumanGapResolution:pendingValidation?.phase!=='authority_handoff' });
      } catch (error) {
        if (isCapacityUnavailable(error) && error?.pendingRootValidation) {
          session.pendingValidation = { ...error.pendingRootValidation, rootInputs };
          const waitingForRework = error.pendingRootValidation.phase === 'rework';
          const outcome = await capacityWait({
            title:waitingForRework?'Root 局部修正':'Validator 认证',
            detail:waitingForRework?'Validator 反馈已保留；等待 Root 对同一结果做一次局部修正。':'Root 候选结果已保留；等待 Validator 认证资源，其他独立 Work Unit 可继续。',
            reason:waitingForRework?'等待 Root 局部修正资源恢复':'等待 Validator 认证资源恢复',
          });
          if (outcome) return outcome;
          continue;
        }
        throw error;
      }

      decision = reviewed.decision;
      consumeHumanTriggerRefs(session,rootTriggerRefs);
      this.consumeRootInputs(session, rootInputs);
      if (rootInputs.length) session.controlHandoffCount = 0;
      if (reviewed.requiresRootDecision) {
        if (pendingValidation?.phase === 'authority_handoff' || session.controlHandoffCount >= 1) {
          const error = new Error('ROOT_CONTROL_NON_CONVERGENCE: certified state still requires a different control decision, but no new Subagent/Human/External trigger exists.');
          error.nonRetryable = true;
          throw error;
        }
        session.controlHandoffCount += 1;
        session.pendingValidation = {
          phase:'authority_handoff',
          decision,
          feedback:reviewed.feedback || [],
          rootInputs:[],
          triggerRefs:rootTriggerRefs,
        };
        session.actor = { title:'Validator 已认证', status:WorkUnitStatus.COMPLETED, detail:'内容边界已认证并在有价值时写入 History；控制决策已交回 Root。', updatedAt:nowIso(), owner:'validator' };
        this.emit(session,callbacks);
        continue;
      }
      if (decision.kind === 'cancelled') return { kind:'cancelled', quiescent:this.isQuiescent(task.id) };
      if (session.policyContext?.taskMode !== 'analysis' && decision.stageResult) onStageResult?.(decision.stageResult);

      // A Root result may be valuable even while sibling Work Units are still
      // running. Validator has already certified/committed that boundary above.
      // Root cannot implicitly abandon already-issued Work Units, so completion or
      // Human Gateway waits until the active work set naturally reaches a boundary.
      if (this.hasUnfinishedWork(session) && (decision.kind === 'complete' || decision.kind === 'human_gateway')) {
        session.actor = { title:'阶段结论已认证', status:WorkUnitStatus.COMPLETED, detail:reviewed.commits.length?'阶段结论已写入历史；等待已签发 Work Unit 到达明确停止边界。':'阶段结论已认证；等待已签发 Work Unit 到达明确停止边界。', updatedAt:nowIso(), owner:'root' };
        this.emit(session, callbacks);
        continue;
      }

      if (decision.kind === 'delegate') {
        if (!decision.delegations.length) {
          const error = new Error('ROOT_EMPTY_DELEGATION');
          error.nonRetryable = true;
          throw error;
        }
        const knownWorkIds = session.currentStage?.workUnits?.map(unit=>unit.id) || [];
        const plan = validateDelegationPlan(decision.delegations, { knownWorkIds, availableInputRefs:taskInputRefs(task) });
        if(plan.valid){if(this.governanceCompiler?.compileForRole){plan.delegations=plan.delegations.map(item=>{const grant=this.governanceCompiler.compileForRole(task,'subagent',{skillId:item.skillId,workUnit:item})?.authorizedGrant;if(!grant){plan.issues.push(`工作 ${item.id} 缺少 AuthorizedGrant。`);plan.valid=false;return item;}return{...item,projectAccess:String(grant.projectAccess||'none'),networkAccess:grant.networkAccess===true,inputRefs:Array.isArray(grant.inputRefs)?[...grant.inputRefs]:[]};});}else for(const item of plan.delegations)if(item.projectAccess!=='none'||item.networkAccess===true||item.inputRefs.length){plan.issues.push(`工作 ${item.id} 请求受治理能力但没有 GovernanceCompiler。`);plan.valid=false;}}
        const batchSignatures = new Set();
        for (const item of plan.delegations) {
          const signature = workSemanticSignature(item);
          if (batchSignatures.has(signature)) {
            plan.issues.push(`同一 Root 决策重复创建了语义相同的工作：${item.title || item.id}。`);
            plan.valid=false;
          } else if (session.issuedWorkSignatures.has(signature)) {
            plan.issues.push(`工作 ${item.title || item.id} 与当前 Task 已创建的工作语义重复；应消费已有结果或明确新的工作边界。`);
            plan.valid=false;
          }
          batchSignatures.add(signature);
          if (item.skillId && this.governanceCompiler?.hasSkill && !this.governanceCompiler.hasSkill(item.skillId)) {
            plan.issues.push(`工作 ${item.id} 选择了不存在的 Skill：${item.skillId}。`);
            plan.valid=false;
          }
        }
        if (!plan.valid) {
          session.planningRepairCount += 1;
          session.planningFeedback = plan.issues;
          session.planningTriggerRefs = [...rootTriggerRefs];
          session.actor = { title:'Work Unit 契约校验', status:WorkUnitStatus.COMPLETED, detail:'Root 的新工作单不符合 Capability Contract；问题已作为内部规划反馈返回 Root。', updatedAt:nowIso(), owner:'root' };
          this.emit(session, callbacks);
          if (session.planningRepairCount >= MAX_TOTAL_ATTEMPTS) {
            const error = new Error(`ROOT_INVALID_DELEGATION_PLAN: ${plan.issues.join(' | ')}`);
            error.nonRetryable = true;
            throw error;
          }
          continue;
        }
        session.planningFeedback = null;
        session.planningRepairCount = 0;
        session.planningTriggerRefs = [];
        for (const item of plan.delegations) session.issuedWorkSignatures.add(workSemanticSignature(item));
        if (session.currentStage) this.appendToStage(session, plan.delegations);
        else this.createStage(session, plan.delegations);
        this.emit(session, callbacks);
        continue;
      }

      if (decision.kind === 'human_gateway') {
        if (!decision.gateway?.question?.trim()) {
          const error = new Error('ROOT_INVALID_HUMAN_GATEWAY');
          error.nonRetryable = true;
          throw error;
        }
        const snapshot=this.makeSnapshot(session);
        this.discardSession(task.id);
        return { kind:'needs_human', gateway:{...decision.gateway,targetGapId:decision.gateway.gapId||null}, summary:decision.summary, stageResult:session.lastCommittedStageResult, snapshot, quiescent:true };
      }

      if (decision.kind === 'complete') {
        const finalView = decision.resultMode === 'analysis' ? decisionFromCertifiedState(session.analysisState,decision) : null;
        const finalResult = finalView ? renderAnalysisResult(finalView) : composeExecutionResult(decision);
        const finalSummary = finalView ? canonicalAnalysisSummary(finalView) : decision.summary;
        const stageResult = session.lastCommittedStageResult || decision.stageResult || null;
        this.discardSession(task.id);
        return { kind:'completion_proposed', proposal:{ finalResult, summary:finalSummary, stageResult }, quiescent:true };
      }

      const error = new Error('ROOT_INVALID_DECISION');
      error.nonRetryable = true;
      throw error;
    }
  }

}
