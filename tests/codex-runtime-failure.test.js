import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeFailureCode, runtimeFailureOf } from '../src/core/runtime-failure.js';
import { classifyRetry } from '../src/core/retry-policy.js';
import { normalizeCodexRuntimeFailure } from '../src/extensions/executors/codex/runtime-failure.js';

test('Codex transport disconnect becomes provider-neutral NETWORK facts',()=>{
  const error=normalizeCodexRuntimeFailure(new Error('stream disconnected before completion: error sending request for url'));
  assert.equal(runtimeFailureOf(error)?.code,RuntimeFailureCode.NETWORK);
});

test('Codex 403 remains deterministic upstream rejection even when transport wording is present',()=>{
  const error=normalizeCodexRuntimeFailure(new Error('stream disconnected: error sending request; unexpected status 403 Forbidden'));
  assert.deepEqual(runtimeFailureOf(error),{code:RuntimeFailureCode.UPSTREAM_REJECTED,status:403});
});

test('revoked Codex refresh token is AUTH_REQUIRED and must not consume the retry loop',()=>{
  const message='Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.';
  const error=normalizeCodexRuntimeFailure(new Error(message));
  assert.equal(runtimeFailureOf(error)?.code,RuntimeFailureCode.AUTH_REQUIRED);
  assert.deepEqual(classifyRetry(error),{
    retryable:false,
    reason:'执行环境需要重新登录或授权',
    message,
  });
});

test('Codex adapter preserves useful provider-neutral failure metadata',()=>{
  const source=new Error('too many requests');
  source.status=429;
  source.retryAfterMs=2500;
  source.requestId='req-42';
  const error=normalizeCodexRuntimeFailure(source);
  assert.deepEqual(runtimeFailureOf(error),{
    code:RuntimeFailureCode.RATE_LIMIT,
    status:429,
    retryAfterMs:2500,
    requestId:'req-42',
  });
});

test('Codex timeout and explicit abort remain distinct from network disconnect',()=>{
  assert.equal(runtimeFailureOf(normalizeCodexRuntimeFailure(new Error('request timeout after 30s')))?.code,RuntimeFailureCode.TIMEOUT);
  const aborted=new Error('stopped by caller');aborted.name='AbortError';
  assert.equal(runtimeFailureOf(normalizeCodexRuntimeFailure(aborted))?.code,RuntimeFailureCode.ABORTED);
});
