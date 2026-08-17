export const RuntimeFailureCode = Object.freeze({
  NETWORK: 'NETWORK',
  TIMEOUT: 'TIMEOUT',
  RATE_LIMIT: 'RATE_LIMIT',
  QUOTA: 'QUOTA',
  AUTH_REQUIRED: 'AUTH_REQUIRED',
  UPSTREAM_REJECTED: 'UPSTREAM_REJECTED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  ABORTED: 'ABORTED',
  UNKNOWN: 'UNKNOWN',
});

const KNOWN_CODES = new Set(Object.values(RuntimeFailureCode));

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function runtimeFailureOf(error) {
  const raw = error?.runtimeFailure;
  if (!raw || typeof raw !== 'object') return null;
  const status = finiteNumber(raw.status);
  const retryAfterMs = finiteNumber(raw.retryAfterMs);
  const requestId = raw.requestId == null ? null : String(raw.requestId).trim();
  return {
    code: KNOWN_CODES.has(raw.code) ? raw.code : RuntimeFailureCode.UNKNOWN,
    ...(status !== null ? { status } : {}),
    ...(retryAfterMs !== null && retryAfterMs >= 0 ? { retryAfterMs } : {}),
    ...(requestId ? { requestId } : {}),
  };
}

export function attachRuntimeFailure(error, facts = {}) {
  const target = error instanceof Error ? error : new Error(String(error ?? 'Runtime failure'));
  if (runtimeFailureOf(target)) return target;
  target.runtimeFailure = runtimeFailureOf({ runtimeFailure:facts }) || { code:RuntimeFailureCode.UNKNOWN };
  return target;
}
