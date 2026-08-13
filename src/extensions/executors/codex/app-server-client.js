import { spawn, spawnSync } from 'node:child_process';
import readline from 'node:readline';
import { APP_VERSION } from '../../../version.js';
import { CodexRuntimeResolver } from './codex-runtime-resolver.js';

const DIAGNOSTIC_RPC_METHODS=new Set(['initialize','model/list','account/read','config/read','modelProvider/capabilities/read','thread/start','turn/start']);

function childOptions(extra = {}) {
  return {
    ...extra,
    env: process.env,
    windowsHide: true,
    // npm installs Codex as codex.cmd on Windows. cmd/bat shims cannot be
    // launched reliably by child_process without a shell.
    shell: process.platform === 'win32',
  };
}

export class CodexAppServerClient {
  constructor({ command = process.env.CODEX_COMMAND || process.env.TASKBOARD_CODEX_COMMAND || null, runtimeResolver = null, diagnosticLogger = null, turnEventTimeoutMs = 30 * 60 * 1000, subagentExecutionWindowMs = null } = {}) {
    this.runtimeResolver = runtimeResolver || new CodexRuntimeResolver({ env: process.env });
    if (command) {
      this.runtimeResolver.env = { ...this.runtimeResolver.env, CODEX_COMMAND: command };
    }
    this.command = command || null;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.notificationWaiters = [];
    this.recentNotifications = [];
    this.initialized = false;
    this.version = null;
    this.connectPromise = null;
    this.connectionGeneration = 0;
    this.generationListeners = new Set();
    this.diagnosticLogger = diagnosticLogger || (line => console.error(line));
    this.activeTurnCount = 0;
    this.turnEventTimeoutMs = Math.max(1_000, Number(turnEventTimeoutMs) || 30 * 60 * 1000);
    this.subagentExecutionWindowMs = Math.max(1_000, Number(subagentExecutionWindowMs) || this.turnEventTimeoutMs);
  }

  recordDiagnostic(event, data = {}) {
    try {
      this.diagnosticLogger?.(`[codex-runtime] ${JSON.stringify({ ts:new Date().toISOString(), event, ...data })}`);
    } catch { /* diagnostics must never affect execution */ }
  }

  activeRpcMethods() {
    return [...this.pending.values()].map(item=>item?.method).filter(Boolean);
  }

  static probe(command = process.env.CODEX_COMMAND || 'codex') {
    const result = spawnSync(command, ['--version'], childOptions({ encoding: 'utf8', timeout: 8_000 }));
    const output = (result.stdout || result.stderr || '').trim();
    return {
      available: result.status === 0,
      version: result.status === 0 ? output : null,
      error: result.status === 0 ? null : (result.error?.message || output || 'Codex command unavailable'),
    };
  }

  async connect() {
    if (this.child && this.initialized) return;
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = this.openConnection();
    try { await this.connectPromise; }
    finally { this.connectPromise = null; }
  }

  runtimeStatus() {
    return this.runtimeResolver?.status?.() || { state:this.command ? 'ready' : 'missing', available:Boolean(this.command), command:this.command, version:this.version || null, error:null };
  }

  scanRuntime() {
    const current = this.runtimeStatus();
    if (current.preparing || current.available) return current;
    return this.runtimeResolver?.resolveInstalled?.() || current;
  }

  prepareRuntime() {
    return this.runtimeResolver?.prepare?.() || Promise.resolve({ available:Boolean(this.command), command:this.command, version:this.version || null, error:this.command ? null : 'Codex command unavailable' });
  }

  startRuntimePreparation() {
    return this.runtimeResolver?.startPrepare?.() || this.runtimeStatus();
  }

  async probeRuntime({ prepare = true } = {}) {
    const status = prepare ? await this.prepareRuntime() : this.runtimeStatus();
    if (status?.available && status.command) {
      this.command = status.command;
      this.version = status.version || this.version || null;
      return { available:true, version:this.version, error:null, runtime:status };
    }
    return { available:false, version:status?.version || null, error:status?.error || 'Codex command unavailable', runtime:status };
  }

  async openConnection() {
    const runtime = await this.runtimeResolver.requireReady();
    this.command = runtime.command;
    this.version = runtime.version || null;

    this.recordDiagnostic('app-server-spawn',{command:this.command,version:this.version||null,nextGeneration:this.connectionGeneration+1});

    this.child = spawn(this.command, ['app-server', '--listen', 'stdio://'], childOptions({
      stdio: ['pipe', 'pipe', 'pipe'],
    }));
    this.recordDiagnostic('app-server-spawned',{pid:this.child.pid||null,command:this.command,version:this.version||null});

    this.child.on('error', error => this.failAll(error));
    this.child.stderr.on('data', chunk => {
      const text = chunk.toString().trim();
      if (text) {
        console.error('[codex]', text);
        if (/failed to refresh available models|timeout waiting for child process to exit/i.test(text)) {
          this.recordDiagnostic('model-refresh-error',{
            pid:this.child?.pid||null,
            generation:this.connectionGeneration,
            activeRpcMethods:this.activeRpcMethods(),
            message:text.slice(0,1000),
          });
        }
      }
    });
    this.child.on('exit', code => {
      this.recordDiagnostic('app-server-exit',{pid:this.child?.pid||null,generation:this.connectionGeneration,code:code??null});
      const err = new Error(`Codex app-server exited (${code ?? 'unknown'})`);
      this.failAll(err);
      this.initialized = false;
      this.child = null;
    });

    const rl = readline.createInterface({ input: this.child.stdout });
    rl.on('line', line => this.handleLine(line));

    await this.request('initialize', {
      clientInfo: { name: 'taskboard_local', title: 'TaskBoard Local', version: APP_VERSION },
      capabilities: { experimentalApi: true, optOutNotificationMethods: ['item/agentMessage/delta'] },
    }, 12_000);
    this.notify('initialized', {});
    this.initialized = true;
    this.connectionGeneration += 1;
    this.recordDiagnostic('app-server-ready',{pid:this.child?.pid||null,generation:this.connectionGeneration,version:this.version||null});
    for (const listener of [...this.generationListeners]) {
      try { listener(this.connectionGeneration); } catch { /* ignore listener errors */ }
    }
  }

  onConnectionGeneration(listener) {
    if (typeof listener !== 'function') return () => {};
    this.generationListeners.add(listener);
    return () => this.generationListeners.delete(listener);
  }

  failAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    for (const waiter of this.notificationWaiters.splice(0)) {
      waiter.reject(error);
    }
  }

  handleLine(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }

    if (msg.id != null && !msg.method) {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(msg.id);
      if (DIAGNOSTIC_RPC_METHODS.has(pending.method)) {
        this.recordDiagnostic('rpc-end',{method:pending.method,id:msg.id,generation:this.connectionGeneration,durationMs:Date.now()-pending.startedAt,ok:!msg.error});
      }
      if (msg.error) {
        const error = new Error(msg.error.message || JSON.stringify(msg.error));
        error.rpcCode = msg.error.code;
        if ([-32600, -32601, -32602].includes(msg.error.code) || /Invalid request|Invalid params|unknown variant|unknown field/i.test(error.message)) {
          error.nonRetryable = true;
        }
        pending.reject(error);
      } else pending.resolve(msg.result);
      return;
    }

    if (msg.id != null && msg.method) {
      // Codex approval requests are executor events, not Human Gateway. Deny at
      // this boundary; Root may later report a task-level blocker to Scheduler.
      // Permission requests have a different response shape, so handle them
      // before the generic requestApproval branch.
      if (msg.method === 'item/permissions/requestApproval') {
        this.respond(msg.id, { permissions: {} });
      } else if (msg.method.includes('requestApproval')) {
        this.respond(msg.id, { decision: 'decline' });
      } else if (msg.method === 'mcpServer/elicitation/request') {
        this.respond(msg.id, { action: 'decline', content: null });
      } else {
        this.respondError(msg.id, -32601, 'Unsupported client-side request');
      }
      this.emitNotification({ method: msg.method, params: msg.params, serverRequestDenied: true });
      return;
    }

    if (msg.method) this.emitNotification(msg);
  }

  emitNotification(msg) {
    this.recentNotifications.push(msg);
    if (this.recentNotifications.length > 200) this.recentNotifications.shift();
    const waiters = [...this.notificationWaiters];
    for (const waiter of waiters) {
      if (waiter.predicate(msg)) {
        this.notificationWaiters.splice(this.notificationWaiters.indexOf(waiter), 1);
        waiter.resolve(msg);
      }
    }
  }

  waitFor(predicate, timeoutMs = 30 * 60 * 1000) {
    const existingIndex = this.recentNotifications.findIndex(predicate);
    if (existingIndex >= 0) {
      const [existing] = this.recentNotifications.splice(existingIndex, 1);
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        const idx = this.notificationWaiters.indexOf(waiter);
        if (idx >= 0) this.notificationWaiters.splice(idx, 1);
        fn(value);
      };
      const waiter = {
        predicate,
        resolve: value => finish(resolve, value),
        reject: error => finish(reject, error),
      };
      this.notificationWaiters.push(waiter);
      timer = setTimeout(() => waiter.reject(new Error('Timed out waiting for Codex event')), timeoutMs);
      timer?.unref?.();
    });
  }

  request(method, params = {}, timeoutMs = 30_000) {
    if (!this.child?.stdin) return Promise.reject(new Error('Codex app-server is not connected'));
    const id = this.nextId++;
    const startedAt=Date.now();
    if (DIAGNOSTIC_RPC_METHODS.has(method)) {
      this.recordDiagnostic('rpc-start',{method,id,generation:this.connectionGeneration,pid:this.child?.pid||null});
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        if (DIAGNOSTIC_RPC_METHODS.has(method)) {
          this.recordDiagnostic('rpc-timeout',{method,id,generation:this.connectionGeneration,pid:this.child?.pid||null,durationMs:Date.now()-startedAt,timeoutMs});
        }
        reject(new Error(`Timed out calling Codex ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method, startedAt });
      this.child.stdin.write(JSON.stringify({ method, id, params }) + '\n');
    });
  }

  notify(method, params = {}) {
    this.child?.stdin?.write(JSON.stringify({ method, params }) + '\n');
  }

  respond(id, result) {
    this.child?.stdin?.write(JSON.stringify({ id, result }) + '\n');
  }

  respondError(id, code, message) {
    this.child?.stdin?.write(JSON.stringify({ id, error: { code, message } }) + '\n');
  }

  async health() {
    const runtimeNow = this.scanRuntime();
    if (!runtimeNow.available && !this.initialized) {
      this.startRuntimePreparation();
      const current = this.runtimeStatus();
      return {
        available:false,
        preparing:Boolean(current.preparing),
        runtimeState:current.state,
        runtimeSource:current.source || null,
        version:current.version || null,
        connected:false,
        authenticated:false,
        error:current.preparing ? null : (current.error || 'Codex runtime unavailable'),
      };
    }
    const probe = await this.probeRuntime({ prepare:true });
    if (!probe.available) return { ...probe, connected: false, authenticated: false };
    try {
      await this.connect();
      const account = await this.request('account/read', { refreshToken: false }, 8_000);
      const authenticated = account?.requiresOpenaiAuth === false || Boolean(account?.account);
      return {
        available: true,
        connected: true,
        authenticated,
        version: probe.version,
        runtimeState: probe.runtime?.state || 'ready',
        runtimeSource: probe.runtime?.source || null,
        authMode: account?.account?.type || null,
        planType: account?.account?.planType || null,
        error: authenticated ? null : 'Codex is connected but no account is authenticated',
      };
    } catch (error) {
      return {
        available: true,
        connected: false,
        authenticated: false,
        version: probe.version,
        runtimeState: probe.runtime?.state || 'ready',
        runtimeSource: probe.runtime?.source || null,
        authMode: null,
        planType: null,
        error: error.message || String(error),
      };
    }
  }

  validateExecutionGrant({permissionProfile,runtimeWorkspaceRoots}) {
    const profile=String(permissionProfile||'').trim();
    const roots=[...new Set((Array.isArray(runtimeWorkspaceRoots)?runtimeWorkspaceRoots:[]).map(value=>String(value||'').trim()).filter(Boolean))];
    if(!profile||!roots.length){const error=new Error('CODEX_EXECUTION_GRANT_REQUIRED: permissionProfile and runtimeWorkspaceRoots are mandatory.');error.nonRetryable=true;throw error;}
    return{profile,roots};
  }

  sameRuntimeRoots(expected,actual){
    const norm=value=>{const text=String(value||'').replace(/\\/g,'/').replace(/\/$/,'');return process.platform==='win32'?text.toLowerCase():text;};
    const left=[...new Set((expected||[]).map(norm))].sort();const right=[...new Set((actual||[]).map(norm))].sort();
    return left.length===right.length&&left.every((value,index)=>value===right[index]);
  }

  async runTurn({ cwd, writableRoots = [], prompt, inputItems = [], outputSchema, model = null, reasoningEffort = null, networkAccess = false, permissionProfile = null, runtimeWorkspaceRoots = [], environments = null, runtimeConfig = null, onProgress = null, onExecutionStarted = null, signal = null, diagnosticContext = null, stopCondition = null }) {
    const role=diagnosticContext?.role||'root';
    const roleLabel=role==='validator'?'Validator':role==='subagent'?'Subagent':'Root';
    const runningDetail=role==='validator'?'模型正在认证当前证明关系。':role==='subagent'?'模型正在执行当前 Work Unit。':'模型正在进行 Task 级判断。';
    const formedDetail=role==='validator'?'正在等待本轮 Validator 认证完成。':role==='subagent'?'正在等待当前 Work Unit 完成并交回 Root。':'正在等待本轮 Root 判断完成。';
    const completedDetail=role==='validator'?'Validator 本轮认证已完成。':role==='subagent'?'Work Unit 结果已交回 Root。':'Root 本轮判断已完成。';
    const commandDetail=role==='validator'?'正在检查当前证明材料。':role==='subagent'?'正在检查当前 Work Unit 授权输入中的证据。':'正在处理 TaskBoard 临时工作区中的本轮判断材料。';
    const fileChangeDetail=role==='subagent'?'正在修改当前 Work Unit 明确授权的文件范围。':'正在处理 TaskBoard 临时工作区文件。';
    if (signal?.aborted) { const error = new Error('Execution interrupted'); error.interrupted = true; throw error; }
    const executionStartedAt=Date.now();
    const routeMeta={
      taskId:diagnosticContext?.taskId||null,
      workUnitId:diagnosticContext?.workUnitId||null,
      role:diagnosticContext?.role||null,
      routeReason:diagnosticContext?.routeReason||null,
      requestedModel:model||null,
      configuredDefaultModel:diagnosticContext?.configuredDefaultModel||null,
      reasoningEffort:reasoningEffort||null,
      inputBytes:Buffer.byteLength(String(prompt||''),'utf8'),
    };
    const executionGrant=this.validateExecutionGrant({permissionProfile,runtimeWorkspaceRoots});
    this.recordDiagnostic('turn-route',{...routeMeta,permissionProfile:executionGrant.profile,runtimeWorkspaceRootCount:executionGrant.roots.length});
    await this.connect();
    onProgress?.({ summary:'Codex 已连接', detail:'正在建立本轮执行上下文。' });

    const thread = await this.request('thread/start', {
      cwd,
      ephemeral: true,
      approvalPolicy: 'never',
      personality: 'pragmatic',
      permissions:executionGrant.profile,
      runtimeWorkspaceRoots:executionGrant.roots,
      ...(Array.isArray(environments)?{environments}:{}),
      ...(runtimeConfig&&typeof runtimeConfig==='object'?{config:runtimeConfig}:{}),
      ...(model ? { model } : {}),
    });
    const activePermissionProfile=thread?.activePermissionProfile?.id||null;
    if(activePermissionProfile!==executionGrant.profile){const error=new Error(`CODEX_PERMISSION_PROFILE_NOT_APPLIED: requested ${executionGrant.profile}, got ${activePermissionProfile||'none'}`);error.nonRetryable=true;throw error;}
    if(!this.sameRuntimeRoots(executionGrant.roots,thread?.runtimeWorkspaceRoots||[])){const error=new Error('CODEX_RUNTIME_ROOTS_NOT_APPLIED: app-server did not confirm the exact Runtime workspace roots.');error.nonRetryable=true;throw error;}
    const threadId = thread.thread.id;
    const resolvedThreadModel=thread?.thread?.model||thread?.thread?.modelId||null;
    onProgress?.({ summary:'Codex 会话已建立', detail:`正在启动本轮 ${roleLabel} 执行。` });

    const start = await this.request('turn/start', {
      threadId,
      input: [{ type: 'text', text: prompt }, ...inputItems],
      approvalPolicy:'never',
      outputSchema,
      ...(model ? { model } : {}),
      ...(reasoningEffort ? { effort: reasoningEffort } : {}),
    });
    const turnId = start.turn.id;
    const resolvedTurnModel=start?.turn?.model||start?.turn?.modelId||resolvedThreadModel||null;
    this.activeTurnCount += 1;
    const activeAtStart=this.activeTurnCount;
    this.recordDiagnostic('turn-started',{
      ...routeMeta,
      threadId,
      turnId,
      resolvedModel:resolvedTurnModel||null,
      activeTurnCount:activeAtStart,
    });
    const boundedSubagent=diagnosticContext?.role==='subagent'&&String(stopCondition||'').trim();
    const turnStartedAt=Date.now();
    const softBoundaryAt=boundedSubagent?turnStartedAt+Math.floor(this.subagentExecutionWindowMs/3):null;
    const hardBoundaryAt=boundedSubagent?turnStartedAt+Math.floor((this.subagentExecutionWindowMs*2)/3):null;
    let convergenceSteered=false;
    let interruptRequested = false;
    const interrupt = () => {
      if (interruptRequested) return;
      interruptRequested = true;
      this.request('turn/interrupt', { threadId, turnId }, 8_000).catch(error => console.error('[codex interrupt]', error.message || error));
    };
    signal?.addEventListener?.('abort', interrupt, { once: true });
    if (signal?.aborted) interrupt();
    const agentMessages = [];
    let toolCallCount=0;
    let completed = null;
    try {
      onExecutionStarted?.({ threadId, turnId, requestedModel:model||null, resolvedModel:resolvedTurnModel, reasoningEffort:reasoningEffort||null });
      onProgress?.({ summary:'Codex 正在执行', detail:runningDetail });
      // item/completed is the canonical item stream. Current app-server versions
      // may include only a summary final message in turn/completed, so consume
      // both surfaces instead of assuming turn.items contains the transcript.
      while (!completed) {
        const eventPredicate=msg => {
          if (msg.method === 'item/started' || msg.method === 'item/completed') {
            return msg.params?.threadId === threadId && msg.params?.turnId === turnId;
          }
          return msg.method === 'turn/completed' && msg.params?.turn?.id === turnId;
        };
        if(boundedSubagent){
          const now=Date.now();
          if(!convergenceSteered&&now>=softBoundaryAt){
            const steerText=`TaskBoard execution boundary: re-check the original Work Unit stopCondition now: ${String(stopCondition).trim()} Stop expanding scope. Use evidence already collected to satisfy expectedOutput; if it cannot be satisfied, return the blocker/uncertainty instead of starting broader investigation.`;
            convergenceSteered=true;
            try {
              await this.request('turn/steer',{threadId,input:[{type:'text',text:steerText}],expectedTurnId:turnId},8_000);
              this.recordDiagnostic('turn-steered',{...routeMeta,threadId,turnId,reason:'work-unit-convergence',elapsedMs:Date.now()-turnStartedAt});
              onProgress?.({summary:'Work Unit 正在收敛',detail:'已达到执行租约的收敛点；正在按原停止条件用现有证据形成结果，不再扩大调查范围。'});
            } catch (error) {
              // Steering is a convergence hint, not the safety boundary itself.
              // Older/temporarily unhealthy app-server builds must not turn a
              // useful Subagent into a retry storm merely because steer failed.
              this.recordDiagnostic('turn-steer-failed',{...routeMeta,threadId,turnId,reason:'work-unit-convergence',elapsedMs:Date.now()-turnStartedAt,error:error?.message||String(error)});
            }
          }
          if(Date.now()>=hardBoundaryAt){
            try{await this.request('turn/interrupt',{threadId,turnId},8_000);}catch{/* boundary remains authoritative even if interrupt acknowledgement is lost */}
            interruptRequested=true;
            this.recordDiagnostic('turn-execution-boundary',{...routeMeta,threadId,turnId,elapsedMs:Date.now()-turnStartedAt,stopConditionBytes:Buffer.byteLength(String(stopCondition||''),'utf8')});
            try{await this.waitFor(msg=>msg.method==='turn/completed'&&msg.params?.turn?.id===turnId,8_000);}catch{/* stale completion is harmless and bounded */}
            const boundaryError=new Error('WORK_UNIT_EXECUTION_BOUNDARY: Work Unit reached its technical execution lease after a convergence steer.');
            boundaryError.nonRetryable=true;
            boundaryError.executionBoundary=true;
            throw boundaryError;
          }
        }
        const nextBoundary=boundedSubagent?(convergenceSteered?hardBoundaryAt:softBoundaryAt):null;
        const boundaryDelayMs=nextBoundary?Math.max(1,nextBoundary-Date.now()):null;
        const boundaryWakeup=Boolean(nextBoundary&&boundaryDelayMs<=this.turnEventTimeoutMs);
        const waitMs=boundaryWakeup?boundaryDelayMs:this.turnEventTimeoutMs;
        let event;
        try{event=await this.waitFor(eventPredicate,waitMs);}catch(error){
          // A bounded Subagent intentionally uses a shorter wait as a control-loop
          // wakeup for the next lease boundary. That timer expiring is not a
          // Codex event timeout and must not depend on a second millisecond-level
          // Date.now comparison. Real connection/event errors still propagate.
          if(boundaryWakeup&&error?.message==='Timed out waiting for Codex event')continue;
          throw error;
        }

        if (event.method === 'item/started') {
          const item = event.params?.item;
          const type=String(item?.type||'');
          const roleCanExecute=role==='subagent';
          const roleCanWrite=roleCanExecute&&diagnosticContext?.projectAccess==='write';
          const roleCanNetwork=roleCanExecute&&diagnosticContext?.networkAccess===true;
          const forbiddenAmbient=new Set(['mcpToolCall','collabToolCall','dynamicToolCall']);
          const actionViolation=forbiddenAmbient.has(type)||(type==='commandExecution'&&!roleCanExecute)||(type==='fileChange'&&!roleCanWrite)||(type==='webSearch'&&!roleCanNetwork);
          if(actionViolation){
            interrupt();
            const error=new Error(`ROLE_EXECUTION_SURFACE_VIOLATION: ${role} cannot execute ${type||'unknown'} under the current Execution Grant.`);error.nonRetryable=true;error.authorityViolation=true;throw error;
          }
          if (type === 'commandExecution') { toolCallCount+=1; onProgress?.({ summary:'正在核对证据', detail:commandDetail }); }
          else if (type === 'fileChange') onProgress?.({ summary:'Codex 正在处理文件变更', detail:fileChangeDetail });
          continue;
        }

        if (event.method === 'item/completed') {
          const item = event.params?.item;
          if (item?.type === 'agentMessage' && typeof item.text === 'string' && item.text.trim()) {
            agentMessages.push(item.text);
            onProgress?.({ summary:'Codex 已形成阶段输出', detail:formedDetail });
          } else if (item?.type === 'commandExecution') {
            onProgress?.({ summary:'证据检查完成', detail:'正在根据刚取得的证据判断是否还需要继续调查。' });
          }
          continue;
        }
        completed = event;
      }

      const turn = completed.params.turn;
      if (turn.status !== 'completed') {
        const error = new Error(turn.error?.message || `Codex turn ${turn.status}`);
        if (turn.status === 'interrupted' || signal?.aborted) error.interrupted = true;
        throw error;
      }
      const fallback = Array.isArray(turn.items)
        ? [...turn.items].reverse().find(i => i?.type === 'agentMessage' && typeof i.text === 'string' && i.text.trim())?.text
        : null;
      const finalText = agentMessages.length ? agentMessages[agentMessages.length - 1] : fallback;
      if (!finalText) throw new Error('Codex returned no final agent message');
      const usage=turn?.usage||turn?.tokenUsage||turn?.tokens||null;
      this.recordDiagnostic('turn-completed',{
        ...routeMeta,
        threadId,
        turnId,
        resolvedModel:turn?.model||turn?.modelId||resolvedTurnModel||null,
        elapsedMs:Date.now()-executionStartedAt,
        toolCallCount,
        outputBytes:Buffer.byteLength(finalText,'utf8'),
        usage:usage&&typeof usage==='object'?usage:null,
        activeTurnCount:this.activeTurnCount,
      });
      onProgress?.({ summary:'Codex 本轮执行完成', detail:completedDetail });
      return finalText;
    } catch(error) {
      this.recordDiagnostic('turn-failed',{
        ...routeMeta,
        threadId,
        turnId,
        resolvedModel:resolvedTurnModel||null,
        elapsedMs:Date.now()-executionStartedAt,
        toolCallCount,
        activeTurnCount:this.activeTurnCount,
        interrupted:Boolean(error?.interrupted||signal?.aborted),
        error:error?.message||String(error),
      });
      throw error;
    } finally {
      signal?.removeEventListener?.('abort', interrupt);
      this.activeTurnCount=Math.max(0,this.activeTurnCount-1);
      this.recordDiagnostic('turn-released',{...routeMeta,threadId,turnId,activeTurnCount:this.activeTurnCount});
    }
  }

  close() {
    const error = new Error('Codex app-server closed');
    error.interrupted = true;
    this.failAll(error);
    try { this.child?.stdin?.end(); } catch { /* ignore */ }
    try { this.child?.kill(); } catch { /* ignore */ }
    this.child = null;
    this.initialized = false;
    this.connectPromise = null;
  }
}
