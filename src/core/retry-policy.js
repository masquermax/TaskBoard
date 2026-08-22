import { RuntimeFailureCode, runtimeFailureOf } from './runtime-failure.js';

export const MAX_TOTAL_ATTEMPTS = 5;

export function messageOf(error) {
  return error?.message || String(error || '未知错误');
}

export function isInterrupted(error) {
  return Boolean(runtimeFailureOf(error)?.code === RuntimeFailureCode.ABORTED || error?.interrupted || error?.name === 'AbortError' || /interrupted|aborted/i.test(messageOf(error)));
}

// Capacity shortage is not an execution failure. It means no new Root/Subagent
// resource can be obtained now, so keep the work READY/WAITING_RESOURCE and try
// again after a short interval without consuming the 1/5 failure budget.
export function isCapacityUnavailable(error) {
  const message = messageOf(error);
  return Boolean(error?.capacityUnavailable || /server overloaded|retry later|no available (?:agent|worker|slot|capacity)|concurren(?:cy|t).*limit|too many concurrent|resource busy/i.test(message));
}

function classifyRuntimeFailure(failure, message) {
  switch (failure.code) {
    case RuntimeFailureCode.AUTH_REQUIRED:
      return { retryable:false, reason:'执行环境需要重新登录或授权', message };
    case RuntimeFailureCode.UPSTREAM_REJECTED:
      return { retryable:false, reason:'执行请求被上游环境拒绝', message };
    case RuntimeFailureCode.INVALID_REQUEST:
      return { retryable:false, reason:'执行参数或环境配置错误', message };
    case RuntimeFailureCode.ABORTED:
      return { retryable:false, reason:'执行已中止', message };
    case RuntimeFailureCode.RATE_LIMIT:
      return { retryable:true, reason:'执行器请求频率受限', message };
    case RuntimeFailureCode.QUOTA:
      return { retryable:true, reason:'当前执行额度不可用', message };
    case RuntimeFailureCode.TIMEOUT:
      return { retryable:true, reason:'执行器响应超时', message };
    case RuntimeFailureCode.NETWORK:
      return { retryable:true, reason:'Executor 流式连接中断', message };
    default:
      return { retryable:true, reason:'执行环境暂时不可用', message };
  }
}

function isAuthenticationFailureMessage(message) {
  return /not authenticated|authentication required|login required|unauthenticated|\b401\b|unauthorized|refresh token.*revoked|access token.*could not be refreshed|log out.*sign in again|sign in again/i.test(String(message||''));
}

export function classifyRetry(error) {
  const message = messageOf(error);
  if (error?.nonRetryable) return { retryable: false, reason: '确定性执行错误', message };
  const runtimeFailure = runtimeFailureOf(error);
  if (runtimeFailure) return classifyRuntimeFailure(runtimeFailure, message);
  if (error?.authRequired || isAuthenticationFailureMessage(message)) {
    return { retryable: false, reason: '执行环境需要重新登录或授权', message };
  }
  if (error?.upstreamRejected || /\b403\b|forbidden/i.test(message)) {
    return { retryable: false, reason: '执行请求被上游环境拒绝', message };
  }
  if (/Invalid request|Invalid params|unknown variant|unknown field|unsupported|PROJECT_PATH_NOT_FOUND|ENOENT/i.test(message)) {
    return { retryable: false, reason: '执行参数或环境配置错误', message };
  }
  return { retryable: true, reason: retryReasonFromMessage(message), message };
}

export function retryReasonFromMessage(message) {
  if (/rate.?limit|too many requests|429/i.test(message)) return '执行器请求频率受限';
  if (/usage|quota|limit reached|insufficient.*quota|agentic/i.test(message)) return '当前执行额度不可用';
  if (/timed? out|timeout/i.test(message)) return '执行器响应超时';
  if (/stream disconnected|error sending request|responses_websocket|websocket|ECONN|ENET|EHOST|socket|network|connection|app-server exited|not connected/i.test(message)) return 'Executor 流式连接中断';
  return '执行环境暂时不可用';
}

export function retryDelayMs(failureCount, overrides = null, random = Math.random) {
  const steps = overrides || [5_000, 30_000, 120_000, 300_000];
  const base=steps[Math.min(Math.max(failureCount - 1, 0), steps.length - 1)];
  if (overrides) return base;
  // ±25% jitter prevents a group of failed Turns from re-entering an Executor
  // at the same instant after a shared transport interruption.
  const factor=0.75+(Math.max(0,Math.min(1,Number(random?.())||0))*0.5);
  return Math.max(1_000,Math.round(base*factor));
}

export function capacityRetryDelayMs(overrides = null) {
  return Array.isArray(overrides) && overrides.length ? Math.max(1_000, Number(overrides[0]) || 5_000) : 5_000;
}

export function capacityWaitingInstruction(message = '') {
  const detail = String(message || '').trim();
  return `当前没有可用执行资源，工作仍保留在等待队列中。${detail ? `\n${detail}` : ''}\n资源可用后系统会自动继续，无需操作。`;
}

export function suspendedInstruction(reason, message, failureCount) {
  const prefix = failureCount >= MAX_TOTAL_ATTEMPTS
    ? `${reason}，已连续执行失败 ${failureCount} 次，系统已停止自动重试。`
    : `${reason}，继续自动重试无法解决。`;
  return `${prefix}\n${message}\n请根据上面的错误处理对应问题后，再点击右上角 ↻ 重试按钮。`;
}

export function waitingRetryInstruction(reason, message, failureCount, delayMs) {
  const next = failureCount + 1;
  const seconds = Math.max(1, Math.round(delayMs / 1000));
  return `${reason}。\n${message}\n本轮第 ${failureCount} 次执行未成功，已失败 ${failureCount}/${MAX_TOTAL_ATTEMPTS}；系统将在 ${seconds} 秒后自动进行第 ${next} 次重试。\n无需操作。`;
}
