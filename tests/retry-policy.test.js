import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRetry, retryReasonFromMessage } from '../src/core/retry-policy.js';

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
  for(const message of ['401 Unauthorized','not authenticated','login required']){
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

test('generic transport copy stays Executor-agnostic',()=>{
  assert.equal(retryReasonFromMessage('stream disconnected before completion'),'Executor 流式连接中断');
});
