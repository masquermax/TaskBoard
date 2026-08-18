import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRetry, isInterrupted, retryReasonFromMessage } from '../src/core/retry-policy.js';
import { RuntimeFailureCode, attachRuntimeFailure } from '../src/core/runtime-failure.js';

test('Work Unit execution boundary is a distinct non-retryable runtime outcome',()=>{
  const error=new Error('WORK_UNIT_EXECUTION_BOUNDARY: lease reached');
  error.executionBoundary=true;
  error.nonRetryable=true;
  assert.deepEqual(classifyRetry(error),{
    retryable:false,
    reason:'Work Unit 已达到执行边界',
    message:'WORK_UNIT_EXECUTION_BOUNDARY: lease reached',
  });
});

test('explicit authentication failures remain auth-required',()=>{
  for(const message of [
    '401 Unauthorized',
    'not authenticated',
    'login required',
    'Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.',
  ]){
    assert.deepEqual(classifyRetry(new Error(message)),{retryable:false,reason:'执行环境需要重新登录或授权',message});
  }
});

test('generic forbidden is an upstream rejection rather than a false login instruction',()=>{
  const message='unexpected status 403 Forbidden: This account only allows approved clients';
  assert.deepEqual(classifyRetry(new Error(message)),{retryable:false,reason:'执行请求被上游环境拒绝',message});
});

test('explicit upstream rejection facts do not depend on provider-specific message wording',()=>{
  const error=new Error('policy denied request');error.upstreamRejected=true;
  assert.deepEqual(classifyRetry(error),{retryable:false,reason:'执行请求被上游环境拒绝',message:'policy denied request'});
});

test('structured Runtime network facts drive retry without provider wording',()=>{
  const error=attachRuntimeFailure(new Error('opaque transport failure'),{code:RuntimeFailureCode.NETWORK,requestId:'req-1'});
  assert.deepEqual(classifyRetry(error),{retryable:true,reason:'Executor 流式连接中断',message:'opaque transport failure'});
});

test('structured deterministic rejection wins over misleading transport copy',()=>{
  const message='stream disconnected before completion: error sending request; policy rejected upstream';
  const error=attachRuntimeFailure(new Error(message),{code:RuntimeFailureCode.UPSTREAM_REJECTED,status:403});
  assert.deepEqual(classifyRetry(error),{retryable:false,reason:'执行请求被上游环境拒绝',message});
});

test('structured abort remains interruption rather than a retryable network failure',()=>{
  const error=attachRuntimeFailure(new Error('operation stopped'),{code:RuntimeFailureCode.ABORTED});
  assert.equal(isInterrupted(error),true);
  assert.deepEqual(classifyRetry(error),{retryable:false,reason:'执行已中止',message:'operation stopped'});
});

test('generic transport copy stays Executor-agnostic',()=>{
  assert.equal(retryReasonFromMessage('stream disconnected before completion'),'Executor 流式连接中断');
});
