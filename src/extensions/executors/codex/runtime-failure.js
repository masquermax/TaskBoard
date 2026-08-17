import { RuntimeFailureCode, attachRuntimeFailure, runtimeFailureOf } from '../../../core/runtime-failure.js';

function messageOf(error) {
  return error?.message || String(error || 'Codex Runtime failure');
}

function statusOf(error, message) {
  const values=[error?.status,error?.statusCode,error?.response?.status,error?.cause?.status,error?.cause?.statusCode];
  for (const value of values) {
    const status=Number(value);
    if (Number.isInteger(status) && status>=100 && status<=599) return status;
  }
  const match=String(message||'').match(/\b([45]\d{2})\b/);
  return match ? Number(match[1]) : null;
}

function retryAfterMsOf(error) {
  const values=[error?.retryAfterMs,error?.providerRetryAfterMs,error?.response?.retryAfterMs,error?.cause?.retryAfterMs];
  for (const value of values) {
    const number=Number(value);
    if (Number.isFinite(number) && number>=0) return number;
  }
  return null;
}

function requestIdOf(error) {
  const values=[error?.requestId,error?.request_id,error?.response?.requestId,error?.cause?.requestId];
  for (const value of values) {
    if (value != null && String(value).trim()) return String(value).trim();
  }
  return null;
}

export function normalizeCodexRuntimeFailure(error) {
  const target=error instanceof Error ? error : new Error(messageOf(error));
  if (runtimeFailureOf(target)) return target;
  const message=messageOf(target);
  const status=statusOf(target,message);
  let code=RuntimeFailureCode.UNKNOWN;

  if (target.interrupted || target.name==='AbortError' || /\baborted\b|\binterrupted\b/i.test(message)) {
    code=RuntimeFailureCode.ABORTED;
  } else if (status===401 || /not authenticated|authentication required|login required|unauthenticated|unauthorized/i.test(message)) {
    code=RuntimeFailureCode.AUTH_REQUIRED;
  } else if (status===403 || /\bforbidden\b|upstream.*reject|request.*rejected/i.test(message)) {
    code=RuntimeFailureCode.UPSTREAM_REJECTED;
  } else if (status===429 || /rate.?limit|too many requests/i.test(message)) {
    code=RuntimeFailureCode.RATE_LIMIT;
  } else if (/insufficient.*quota|quota|usage limit|limit reached/i.test(message)) {
    code=RuntimeFailureCode.QUOTA;
  } else if (/timed? out|timeout/i.test(message)) {
    code=RuntimeFailureCode.TIMEOUT;
  } else if (/invalid request|invalid params|unknown variant|unknown field|unsupported|project_path_not_found|enoent/i.test(message)) {
    code=RuntimeFailureCode.INVALID_REQUEST;
  } else if (/stream disconnected|error sending request|responses_websocket|websocket|econn|enet|ehost|socket|network|connection reset|connection closed|app-server exited|not connected|fetch failed|und_err/i.test(message)) {
    code=RuntimeFailureCode.NETWORK;
  }

  return attachRuntimeFailure(target,{
    code,
    ...(status == null ? {} : {status}),
    ...(retryAfterMsOf(target) == null ? {} : {retryAfterMs:retryAfterMsOf(target)}),
    ...(requestIdOf(target) ? {requestId:requestIdOf(target)} : {}),
  });
}
