import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRetry } from '../src/core/retry-policy.js';

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
