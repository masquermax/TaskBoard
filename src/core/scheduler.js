import { TaskStatus, ReadyReason, CompletionReason, WorkUnitStatus } from './types.js';
import { MAX_TOTAL_ATTEMPTS, capacityRetryDelayMs, capacityWaitingInstruction, classifyRetry, isCapacityUnavailable, retryDelayMs, suspendedInstruction, waitingRetryInstruction, isInterrupted } from './retry-policy.js';
import { recordTaskDiagnostic } from './runtime-diagnostic.js';
import { addUnresolvedEffectAttempt, clearUnresolvedEffectAttempt, hasUnresolvedEffectRecovery, recoverStaleEffectState, withPreservedEffectRecovery } from './effect-recovery.js';

function nowIso() { return new Date().toISOString(); }

function actorLabel(owner) {
  if (owner === 'validator') return 'Validator';
  if (owner === 'subagent') return 'Subagent';
  return 'Root';
}

function snapshotProgressDetail(snapshot) {
  const owner=snapshot?.actor?.owner;
  if(owner==='validator')return 'Validator 正在认证当前候选结果。';
  if(owner==='root')return 'Root 正在进行 Task 级判断。';
  const running=(snapshot?.stage?.workUnits||[]).filter(unit=>unit?.status===WorkUnitStatus.RUNNING&&unit?.owner==='subagent');
  if(running.length)return `Subagent 正在执行 ${running.length} 项 Work Unit。`;
  return '当前阶段正在推进。';
}

function recoveryState(task,nextState={}) {
  return withPreservedEffectRecovery(task?.executionState,nextState);
}

export class Scheduler {
  constructor({ repository, taskService, rootRuntime, maxConcurrentTasks = 2, capabilityLimits = null, intervalMs = 1200, retryDelaysMs = null }) {
    this.repository = repository;
    this.taskService = taskService;
    this.rootRuntime = rootRuntime;
    this.maxConcurrentTasks = Math.max(1, Math.min(5, Number(maxConcurrentTasks) || 1));
    this.capabilityLimits = typeof capabilityLimits === 'function' ? capabilityLimits : null;
    this.intervalMs = intervalMs;
    this.retryDelaysMs = retryDelaysMs;
    this.activeTasks = new Set();
    this.claimedTasks = new Set();
    this.activities = new Map();
    this.timer = null;
    this.shuttingDown = false;
  }

  setConcurrency(value) { this.maxConcurrentTasks = Math.max(1, Math.min(5, Number(value) || 1)); return this.maxConcurrentTasks; }

  effectiveConcurrency() {
    const limit = Number(this.capabilityLimits?.()?.taskConcurrency);
    return Number.isInteger(limit) && limit > 0 ? Math.min(this.maxConcurrentTasks, limit) : this.maxConcurrentTasks;
  }

  start() {
    if (this.timer || this.shuttingDown) return;
    this.timer = setInterval(() => this.tick().catch(err => console.error('[scheduler]',err)),this.intervalMs);
    this.timer?.unref?.();
    this.tick().catch(err => console.error('[scheduler]',err));
  }

  stop() { if(this.timer)clearInterval(this.timer);this.timer=null; }

  beginShutdown() {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.stop();
    for (const taskId of [...this.claimedTasks]) {
      const current=this.repository.getTask(taskId);
      const snapshot=this.rootRuntime.snapshot(taskId);
      if(current&&snapshot)this.repository.setExecutionState(taskId,recoveryState(current,{snapshot}));
      this.rootRuntime.interruptForShutdown?.(taskId);
    }
  }

  async waitForIdle(timeoutMs = 1200) {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0);
    while (this.claimedTasks.size && Date.now() < deadline) await new Promise(resolveWait => setTimeout(resolveWait, 20));
    return this.claimedTasks.size === 0;
  }

  createTask(payload) { return this.taskService.createTask(payload); }

  executorReadiness() {
    try { return this.rootRuntime?.executor?.readiness?.() || { ready:true, preparing:false, reason:null, message:null }; }
    catch (error) { return { ready:false, preparing:false, reason:'executor-readiness-error', message:error?.message || String(error) }; }
  }

  setActivity(taskId, activity) {
    const value = { taskId, updatedAt:nowIso(), ...activity };
    this.activities.set(taskId,value);
    return value;
  }

  currentHistory(taskId) { return this.repository.getProgressHistory(taskId); }

  getTaskActivity(taskId) {
    const task=this.repository.getTask(taskId);if(!task||task.deleted_at)return null;
    const current=this.activities.get(taskId);
    if(current)return { ...current, history:this.currentHistory(taskId) };
    const snapshot=task.executionState?.snapshot || null;
    if(task.status===TaskStatus.READY){
      const suspended=task.ready_reason===ReadyReason.SUSPENDED;
      const retrying=task.ready_reason===ReadyReason.RETRY_WAIT;
      const recoveryBlocked=hasUnresolvedEffectRecovery(task.executionState);
      const gate=(suspended||retrying)?null:this.executorReadiness();
      const blocked=gate&&gate.ready===false;
      const retryDetail=snapshot?.stage?.workUnits?.find?.(unit=>unit?.status===WorkUnitStatus.RETRY_WAIT)?.detail
        || task.executionState?.retry?.reason
        || '上一轮执行未成功；系统会在错峰等待后自动重试。';
      return {
        taskId,
        state:suspended?'suspended':'queued',
        summary:recoveryBlocked?'现实操作结果待核对':(suspended?'任务存在挂起项':(retrying?'等待自动重试':(blocked?'等待执行资源':'等待执行'))),
        detail:recoveryBlocked
          ? '上次现实操作的结果仍不确定；系统已停止自动重放，也不会把未知当成失败。'
          : (suspended?'自动恢复已停止，请在挂起项右上角点击 ↻ 重新尝试。':(retrying?retryDetail:(blocked?(gate.message||'当前执行资源尚未就绪。'):'Scheduler 会在满足条件后自动开始。'))),
        updatedAt:task.status_entered_at,
        current:snapshot,
        history:this.currentHistory(taskId),
      };
    }
    if(task.status===TaskStatus.RUNNING){const runtime=this.rootRuntime.snapshot(taskId);return {taskId,state:'running',summary:'正在执行',detail:snapshotProgressDetail(runtime),updatedAt:task.status_entered_at,current:runtime,history:this.currentHistory(taskId)};}
    if(task.status===TaskStatus.WAITING_HUMAN)return {taskId,state:'waiting',summary:'等待你的必要信息',detail:'当前任务已静止，不会在后台继续消耗 Agent。',updatedAt:task.status_entered_at,current:snapshot,history:this.currentHistory(taskId)};
    const cancelled=task.completion_reason===CompletionReason.CANCELLED;
    const recoveryBlocked=hasUnresolvedEffectRecovery(task.executionState);
    return {taskId,state:'completed',summary:cancelled?'任务已取消':'任务已完成',detail:recoveryBlocked?'任务生命周期已结束，但仍保留一次未闭合的现实操作恢复事实。':(cancelled?'后续执行已经停止。':'最终结果已经形成。'),updatedAt:task.status_entered_at,current:null,history:this.currentHistory(taskId)};
  }

  recoverStaleRunningTasks() {
    const stale=this.repository.listStaleRunningTasks();
    for(const task of stale){
      const recoveredState=recoverStaleEffectState(task);
      const unresolved=hasUnresolvedEffectRecovery(recoveredState);
      if(task.cancel_requested_at){
        this.repository.cancelPendingGateway(task.id);
        this.repository.transitionTask(task.id,TaskStatus.COMPLETED,{
          completionReason:CompletionReason.CANCELLED,
          finalResult:task.final_result||'任务已由用户取消。',
          clearCancel:true,
          executionState:unresolved?recoveredState:null,
        });
      }else if(unresolved){
        const state=withPreservedEffectRecovery(recoveredState,{
          snapshot:recoveredState.snapshot||null,
          retry:{scope:'effect-recovery',failureCount:0,paused:true,nextAt:null,reason:'现实操作结果未知',error:null},
        });
        this.repository.transitionTask(task.id,TaskStatus.READY,{readyReason:ReadyReason.SUSPENDED,executionState:state});
      }else{
        this.repository.transitionTask(task.id,TaskStatus.READY,{readyReason:ReadyReason.WAITING_RESOURCE,executionState:recoveredState});
      }
    }
    return stale.length;
  }

  async tick() {
    if(this.shuttingDown)return;
    const gate=this.executorReadiness();if(gate&&gate.ready===false)return;
    const available=Math.max(0,this.effectiveConcurrency()-this.claimedTasks.size);if(!available)return;
    const candidates=this.repository.listRunnableTasks(available*4,Date.now()).filter(t=>!this.claimedTasks.has(t.id)).slice(0,available);
    await Promise.all(candidates.map(t=>this.runClaimed(t.id)));
  }

  ensureQuiescent(taskId) {
    if(!this.rootRuntime.isQuiescent(taskId))throw new Error('TASK_NOT_QUIESCENT');
  }

  retryStateFromFailure(task,error) {
    const previous=task.executionState?.retry;
    const previousCount=previous?.scope==='root'&&!previous?.reset ? Number(previous.failureCount||0) : 0;
    const failureCount=previousCount+1;
    const policy=classifyRetry(error);
    const rootUnit={id:'root',title:'综合分析',status:WorkUnitStatus.RETRY_WAIT,detail:'',updatedAt:nowIso(),failureCount,nextRetryAt:null,canRetry:false,owner:'root'};
    let retry;
    let readyReason;
    if(!policy.retryable||failureCount>=MAX_TOTAL_ATTEMPTS){
      rootUnit.status=WorkUnitStatus.SUSPENDED;rootUnit.canRetry=true;rootUnit.detail=suspendedInstruction(policy.reason,policy.message,failureCount);
      retry={scope:'root',failureCount,paused:true,nextAt:null,reason:policy.reason,error:policy.message};
      readyReason=ReadyReason.SUSPENDED;
    }else{
      const delay=retryDelayMs(failureCount,this.retryDelaysMs);const nextAt=new Date(Date.now()+delay).toISOString();
      rootUnit.nextRetryAt=nextAt;rootUnit.detail=waitingRetryInstruction(policy.reason,policy.message,failureCount,delay);
      retry={scope:'root',failureCount,paused:false,nextAt,reason:policy.reason,error:policy.message};
      readyReason=ReadyReason.RETRY_WAIT;
    }
    return {retry,readyReason,snapshot:{taskId:task.id,actor:null,stage:{id:'root-retry',title:'当前阶段',startedAt:task.status_entered_at,workUnits:[rootUnit]},updatedAt:rootUnit.updatedAt}};
  }

  persistEffectAttempt(taskId,attempt){
    if(this.shuttingDown){const error=new Error('EFFECT_RECOVERY_PERSISTENCE_UNAVAILABLE_DURING_SHUTDOWN');error.nonRetryable=true;throw error;}
    const current=this.repository.getTask(taskId);if(!current)throw new Error('TASK_NOT_FOUND');
    this.repository.setExecutionState(taskId,addUnresolvedEffectAttempt(current.executionState,attempt));
  }

  clearEffectAttempt(taskId,attemptId){
    if(this.shuttingDown){const error=new Error('EFFECT_RECOVERY_PERSISTENCE_UNAVAILABLE_DURING_SHUTDOWN');error.nonRetryable=true;throw error;}
    const current=this.repository.getTask(taskId);if(!current)throw new Error('TASK_NOT_FOUND');
    this.repository.setExecutionState(taskId,clearUnresolvedEffectAttempt(current.executionState,attemptId));
  }

  async runClaimed(taskId) {
    if(this.shuttingDown||this.claimedTasks.has(taskId))return;
    let task=this.repository.getTask(taskId);if(!task||task.status!==TaskStatus.READY||task.deleted_at)return;
    if(hasUnresolvedEffectRecovery(task.executionState))return;
    this.claimedTasks.add(taskId);
    let admitted=false;
    const admit=(meta={})=>{
      if(admitted||this.shuttingDown)return;
      const current=this.repository.getTask(taskId);
      if(!current||current.deleted_at)throw new Error('TASK_NOT_FOUND');
      if(current.status===TaskStatus.READY)task=this.repository.transitionTask(taskId,TaskStatus.RUNNING,{executionState:current.executionState});
      else if(current.status===TaskStatus.RUNNING)task=current;
      else throw new Error('TASK_ADMISSION_STATE_CHANGED');
      admitted=true;this.activeTasks.add(taskId);
      const owner=meta?.role||this.rootRuntime.snapshot(taskId)?.actor?.owner||'root';
      this.setActivity(taskId,{state:'running',summary:'已获得执行资源',detail:`${actorLabel(owner)} 已开始本轮执行。`,current:this.rootRuntime.snapshot(taskId)});
    };
    try{
      const outcome=await this.rootRuntime.execute(task,{
        onExecutionStarted:admit,
        humanGatewayHistory:this.repository.listGatewayHistory(taskId),
        onProgress:snapshot=>this.setActivity(taskId,admitted?{state:'running',summary:'当前阶段正在推进',detail:snapshotProgressDetail(snapshot),current:snapshot}:{state:'queued',summary:'等待执行资源',detail:'正在等待本轮所需的执行资源；获得真实执行资源前任务仍保持「需执行」。',current:snapshot}),
        onCertifiedTurn:commit=>{if(!this.shuttingDown)this.repository.commitCertifiedTurn(taskId,commit);},
        onTaskContractAuthority:authority=>{if(this.shuttingDown){const error=new Error('TASK_CONTRACT_PERSISTENCE_UNAVAILABLE_DURING_SHUTDOWN');error.nonRetryable=true;throw error;}this.repository.commitTaskContractAuthority(taskId,authority);},
        onEffectAttempt:attempt=>this.persistEffectAttempt(taskId,attempt),
        onEffectAttemptCleared:attemptId=>this.clearEffectAttempt(taskId,attemptId),
        onWorkReceipt:receipt=>{
          if(this.shuttingDown){const error=new Error('WORK_RECEIPT_PERSISTENCE_UNAVAILABLE_DURING_SHUTDOWN');error.nonRetryable=true;throw error;}
          this.repository.commitWorkReceipt(taskId,receipt);
          if(receipt?.effectAttemptId)this.clearEffectAttempt(taskId,receipt.effectAttemptId);
        },
        onWorkReceiptsConsumed:ids=>{if(!this.shuttingDown)this.repository.consumeWorkReceipts(taskId,ids);},
        onProgressCommit:commit=>{if(this.shuttingDown)return;const history=this.repository.getProgressHistory(taskId);if(history.some(item=>item.title===commit.title&&item.detail===commit.detail))return;this.repository.commitProgressHistory(taskId,commit);},
        onStageCompleted:()=>{},
      });

      if(this.shuttingDown){this.rootRuntime.discardSession(taskId);return;}
      let current=this.repository.getTask(taskId);if(!current)return;
      if(current.cancel_requested_at||outcome.kind==='cancelled'){
        this.ensureQuiescent(taskId);
        this.rootRuntime.discardSession(taskId);
        this.repository.cancelPendingGateway(taskId);
        const unresolved=hasUnresolvedEffectRecovery(current.executionState);
        const done=this.repository.transitionTask(taskId,TaskStatus.COMPLETED,{completionReason:CompletionReason.CANCELLED,finalResult:current.final_result||'任务已由用户取消，后续执行已停止。',clearCancel:true,executionState:unresolved?current.executionState:null});
        this.setActivity(taskId,{state:'completed',summary:'任务已取消',detail:unresolved?'任务已取消；未闭合的现实操作恢复事实仍被保留，不会被当成未发生。':'Root 已完成收尾，后续执行已停止。',current:null});
        if(!unresolved)this.rootRuntime.cleanupTaskWorkspace?.(taskId);
        return done;
      }

      if(outcome.kind==='goal_satisfied'){
        if(!admitted){const error=new Error('EXECUTOR_START_NOT_REPORTED');error.nonRetryable=true;throw error;}
        this.ensureQuiescent(taskId);
        current=this.repository.getTask(taskId);if(!current)return;
        if(hasUnresolvedEffectRecovery(current.executionState)){
          const state=recoveryState(current,{snapshot:current.executionState?.snapshot||null,retry:{scope:'effect-recovery',failureCount:0,paused:true,nextAt:null,reason:'现实操作结果未知',error:null}});
          const ready=this.repository.transitionTask(taskId,TaskStatus.READY,{readyReason:ReadyReason.SUSPENDED,executionState:state});
          this.setActivity(taskId,{state:'suspended',summary:'现实操作结果待核对',detail:'Completion 已满足，但旧现实操作仍可能继续改变结果；系统不会在恢复事实闭合前宣告执行收尾。',current:state.snapshot||null});
          this.rootRuntime.discardSession(taskId);
          return ready;
        }
        const proposal=outcome.proposal||{};
        const done=this.repository.transitionTask(taskId,TaskStatus.COMPLETED,{completionReason:CompletionReason.SUCCESS,finalResult:proposal.finalResult,lastStageResult:proposal.stageResult,clearCancel:true,executionState:null});
        this.setActivity(taskId,{state:'completed',summary:'任务已完成',detail:proposal.summary||'CompletionEvaluator 已确认 governed obligations 满足。',current:null});
        this.rootRuntime.cleanupTaskWorkspace?.(taskId);
        return done;
      }

      if(outcome.kind==='needs_human'){
        if(!admitted){const error=new Error('EXECUTOR_START_NOT_REPORTED');error.nonRetryable=true;throw error;}
        this.ensureQuiescent(taskId);
        const withGateway=this.repository.createGatewayRecord(taskId,outcome.gateway);
        const createdGateway=withGateway?.pendingGateway||null;
        recordTaskDiagnostic('human-gateway-created',{taskId,gatewayId:createdGateway?.id||null,targetGapId:createdGateway?.targetGapId??createdGateway?.target_gap_id??outcome.gateway?.targetGapId??outcome.gateway?.gapId??null,optionCount:Array.isArray(createdGateway?.options)?createdGateway.options.length:Array.isArray(outcome.gateway?.options)?outcome.gateway.options.length:0});
        current=this.repository.getTask(taskId);
        const state=recoveryState(current,{snapshot:outcome.snapshot||null});
        const waiting=this.repository.transitionTask(taskId,TaskStatus.WAITING_HUMAN,{lastStageResult:outcome.stageResult,executionState:state});
        this.setActivity(taskId,{state:'waiting',summary:'等待你的必要信息',detail:'Root 已将执行收敛到静止，收到回复前不会继续执行。',current:outcome.snapshot||null});
        return waiting;
      }

      if(outcome.kind==='waiting_resource'||outcome.kind==='retry_wait'){
        this.ensureQuiescent(taskId);
        current=this.repository.getTask(taskId);
        const retrying=outcome.kind==='retry_wait';
        const state=recoveryState(current,{snapshot:outcome.snapshot,retry:{scope:'work-unit',failureCount:0,paused:false,nextAt:new Date(outcome.retryAt).toISOString(),reason:outcome.reason,error:null}});
        const readyReason=retrying?ReadyReason.RETRY_WAIT:ReadyReason.WAITING_RESOURCE;
        const ready=admitted?this.repository.transitionTask(taskId,TaskStatus.READY,{readyReason,executionState:state}):this.repository.touchTask(taskId,{readyReason,executionState:state});
        this.setActivity(taskId,{state:'queued',summary:retrying?'等待自动重试':'等待执行资源',detail:retrying?'上一轮执行已失败；系统会在错峰等待后自动重试。':'当前没有 Agent 在执行；资源可用后 Scheduler 会自动继续。',current:outcome.snapshot});
        return ready;
      }

      if(outcome.kind==='suspended'){
        this.ensureQuiescent(taskId);
        current=this.repository.getTask(taskId);
        const suspendedCounts=(outcome.snapshot?.stage?.workUnits||[]).filter(unit=>unit.status===WorkUnitStatus.SUSPENDED).map(unit=>Number(unit.failureCount||0));
        const failureCount=suspendedCounts.length?Math.max(...suspendedCounts):0;
        const recoveryBlocked=hasUnresolvedEffectRecovery(current.executionState);
        const state=recoveryState(current,{snapshot:outcome.snapshot,retry:{scope:recoveryBlocked?'effect-recovery':'work-unit',failureCount,paused:true,nextAt:null,reason:recoveryBlocked?'现实操作结果未知':outcome.reason,error:null}});
        const ready=admitted?this.repository.transitionTask(taskId,TaskStatus.READY,{readyReason:ReadyReason.SUSPENDED,executionState:state}):this.repository.touchTask(taskId,{readyReason:ReadyReason.SUSPENDED,executionState:state});
        this.setActivity(taskId,{state:'suspended',summary:recoveryBlocked?'现实操作结果待核对':'当前阶段存在挂起项',detail:recoveryBlocked?'上次现实操作可能已经发生；系统已停止自动重放。':'自动恢复已经停止，请按卡片正文指引点击右上角 ↻ 重新尝试。',current:outcome.snapshot});
        return ready;
      }
      throw new Error(`ROOT_OUTCOME_UNSUPPORTED:${outcome.kind}`);
    }catch(error){
      if(this.shuttingDown){this.rootRuntime.discardSession(taskId);return;}
      const current=this.repository.getTask(taskId);
      if(current?.cancel_requested_at&&(isInterrupted(error)||this.rootRuntime.isQuiescent(taskId))){
        this.rootRuntime.discardSession(taskId);
        this.repository.cancelPendingGateway(taskId);
        const unresolved=hasUnresolvedEffectRecovery(current.executionState);
        this.repository.transitionTask(taskId,TaskStatus.COMPLETED,{completionReason:CompletionReason.CANCELLED,finalResult:current.final_result||'任务已由用户取消，后续执行已停止。',clearCancel:true,executionState:unresolved?current.executionState:null});
        this.setActivity(taskId,{state:'completed',summary:'任务已取消',detail:unresolved?'任务已取消；现实恢复事实仍被保留。':'Root 已完成收尾。',current:null});
        if(!unresolved)this.rootRuntime.cleanupTaskWorkspace?.(taskId);
        return;
      }
      if(current?.status===TaskStatus.READY&&!admitted&&isCapacityUnavailable(error)){
        const delay=capacityRetryDelayMs(this.retryDelaysMs);const nextAt=new Date(Date.now()+delay).toISOString();
        const snapshot=this.rootRuntime.snapshot(taskId)||{taskId,actor:null,stage:null,updatedAt:nowIso()};
        const state=recoveryState(current,{snapshot,retry:{scope:'root-capacity',failureCount:0,paused:false,nextAt,reason:'等待可用 Root',error:null}});
        this.repository.touchTask(taskId,{readyReason:ReadyReason.WAITING_RESOURCE,executionState:state});
        this.setActivity(taskId,{state:'queued',summary:'等待执行资源',detail:capacityWaitingInstruction(error?.message||''),current:snapshot});
        return;
      }
      if(current?.status===TaskStatus.RUNNING||current?.status===TaskStatus.READY){
        const recoveryBlocked=hasUnresolvedEffectRecovery(current.executionState);
        const failure=this.retryStateFromFailure(current,error);
        this.rootRuntime.discardSession(taskId);
        const state=recoveryState(current,{snapshot:failure.snapshot,retry:recoveryBlocked?{scope:'effect-recovery',failureCount:failure.retry.failureCount,paused:true,nextAt:null,reason:'现实操作结果未知',error:failure.retry.error}:{...failure.retry}});
        const readyReason=recoveryBlocked?ReadyReason.SUSPENDED:failure.readyReason;
        if(current.status===TaskStatus.RUNNING)this.repository.transitionTask(taskId,TaskStatus.READY,{readyReason,executionState:state});
        else this.repository.touchTask(taskId,{readyReason,executionState:state});
        if(recoveryBlocked||failure.retry.paused){
          this.setActivity(taskId,{state:'suspended',summary:recoveryBlocked?'现实操作结果待核对':'执行已挂起',detail:recoveryBlocked?'系统不会把未知结果当成失败重试。':failure.snapshot.stage.workUnits[0].detail,current:failure.snapshot});
          console.error(`[task ${taskId}] execution suspended after ${failure.retry.failureCount} failure(s)`,error);
        }else{
          this.setActivity(taskId,{state:'queued',summary:'等待自动重试',detail:failure.snapshot.stage.workUnits[0].detail,current:failure.snapshot});
          console.error(`[task ${taskId}] execution failed ${failure.retry.failureCount}/${MAX_TOTAL_ATTEMPTS}`,error);
        }
      }
    }finally{this.activeTasks.delete(taskId);this.claimedTasks.delete(taskId);}
  }

  answerHumanGateway(taskId,answer){
    if(!answer?.trim())throw new Error('ANSWER_REQUIRED');
    const task=this.repository.getTask(taskId);if(!task||task.deleted_at)throw new Error('TASK_NOT_FOUND');
    if(task.status!==TaskStatus.WAITING_HUMAN)throw new Error('NO_PENDING_GATEWAY');
    if(this.activeTasks.has(taskId))throw new Error('TASK_NOT_QUIESCENT');
    const pendingGateway=task.pendingGateway||null;
    const gatewayId=this.repository.resolveGatewayRecord(taskId,answer);
    recordTaskDiagnostic('human-gateway-resolved',{taskId,gatewayId,targetGapId:pendingGateway?.targetGapId??pendingGateway?.target_gap_id??null,answerBytes:Buffer.byteLength(answer.trim(),'utf8')});
    const current=this.repository.getTask(taskId);
    const state=hasUnresolvedEffectRecovery(current?.executionState)?current.executionState:null;
    const ready=this.repository.transitionTask(taskId,TaskStatus.READY,{readyReason:state?ReadyReason.SUSPENDED:ReadyReason.HUMAN_REPLY,executionState:state});
    this.activities.delete(taskId);
    return ready;
  }

  requestCancel(taskId){
    let task=this.repository.getTask(taskId);if(!task||task.deleted_at)throw new Error('TASK_NOT_FOUND');
    if(![TaskStatus.RUNNING,TaskStatus.WAITING_HUMAN].includes(task.status))throw new Error('TASK_CANCEL_NOT_ALLOWED');
    this.repository.setCancelRequested(taskId,true);
    task=this.repository.getTask(taskId);
    const active=this.activeTasks.has(taskId);
    if(!active&&this.rootRuntime.isQuiescent(taskId)){
      this.repository.cancelPendingGateway(taskId);
      const unresolved=hasUnresolvedEffectRecovery(task.executionState);
      const done=this.repository.transitionTask(taskId,TaskStatus.COMPLETED,{completionReason:CompletionReason.CANCELLED,finalResult:task.final_result||'任务已由用户取消，后续执行已停止。',clearCancel:true,executionState:unresolved?task.executionState:null});
      this.setActivity(taskId,{state:'completed',summary:'任务已取消',detail:unresolved?'任务生命周期已结束；未闭合的现实操作事实仍保留。':'任务当前没有执行中的 Agent，已直接结束。',current:null});
      if(!unresolved)this.rootRuntime.cleanupTaskWorkspace?.(taskId);
      return {accepted:true,pending:false,task:done};
    }
    this.rootRuntime.requestQuiesce(taskId);
    this.setActivity(taskId,{state:'cancelling',summary:'正在取消任务',detail:'Root 正在停止新的工作分配并收尾当前执行。完成后会自动进入「已完成」。\n无需操作。',current:this.rootRuntime.snapshot(taskId)});
    return {accepted:true,pending:true,task:this.repository.getTask(taskId)};
  }

  deleteTask(taskId){
    const task=this.repository.getTask(taskId);if(!task||task.deleted_at)throw new Error('TASK_NOT_FOUND');
    if(this.claimedTasks.has(taskId)||task.status===TaskStatus.RUNNING)throw new Error('TASK_DELETE_BECAME_RUNNING');
    if(![TaskStatus.READY,TaskStatus.COMPLETED].includes(task.status))throw new Error('TASK_DELETE_NOT_ALLOWED');
    if(task.status===TaskStatus.COMPLETED&&task.locked)throw new Error('TASK_LOCK_NOT_ALLOWED');
    this.repository.setDeleted(taskId,true);this.activities.delete(taskId);this.rootRuntime.discardSession(taskId);this.rootRuntime.cleanupTaskWorkspace?.(taskId);return {deleted:true};
  }

  setLocked(taskId,locked){
    const task=this.repository.getTask(taskId);if(!task||task.deleted_at)throw new Error('TASK_NOT_FOUND');
    if(task.status!==TaskStatus.COMPLETED)throw new Error('TASK_LOCK_NOT_ALLOWED');
    return this.repository.setLocked(taskId,Boolean(locked));
  }

  retryTask(taskId,workUnitId=null){
    const task=this.repository.getTask(taskId);if(!task||task.deleted_at)throw new Error('TASK_NOT_FOUND');
    if(hasUnresolvedEffectRecovery(task.executionState))throw new Error('EFFECT_RECOVERY_REQUIRED');
    let reset=false;
    if(workUnitId&&workUnitId!=='root')reset=this.rootRuntime.retryWorkUnit(taskId,workUnitId);
    if(!reset&&task.status===TaskStatus.RUNNING&&workUnitId)throw new Error('RETRY_TARGET_NOT_SUSPENDED');
    if(task.status===TaskStatus.RUNNING){
      const snapshot=this.rootRuntime.snapshot(taskId);
      this.setActivity(taskId,{state:'running',summary:'已重新尝试挂起项',detail:'新的重试周期从第 1/5 次开始。',current:snapshot});
      return this.repository.getTask(taskId);
    }
    if(task.status!==TaskStatus.READY||task.ready_reason!==ReadyReason.SUSPENDED)throw new Error('TASK_RETRY_NOT_ALLOWED');
    if(!reset)this.rootRuntime.discardSession(taskId);
    const snapshot=reset?this.rootRuntime.snapshot(taskId):null;
    const state={snapshot,retry:{scope:reset?'work-unit':'root',failureCount:0,paused:false,nextAt:new Date().toISOString(),reason:'手动重新尝试',error:null,reset:true}};
    const ready=this.repository.touchTask(taskId,{readyReason:ReadyReason.WAITING_RESOURCE,executionState:state});
    this.setActivity(taskId,{state:'queued',summary:'已重新进入等待执行',detail:'将从第 1/5 次开始重新尝试。',current:snapshot});
    this.tick().catch(err=>console.error('[scheduler retry]',err));
    return ready;
  }
}
