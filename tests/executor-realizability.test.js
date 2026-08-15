import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';

function task(){return{id:'T-D019',projectScopes:[]};}
function policy(networkAccess){return{authorizedGrant:{role:'subagent',projectAccess:'none',networkAccess,environmentAccess:'none'}};}

test('D-019: Executor reports UNAVAILABLE instead of silently weakening required network capability',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-d019-'));
  try{
    const executor=new CodexExecutor({runtimeRoot:dir,networkAccess:false,client:{}});
    assert.throws(()=>executor.executionScope(task(),policy(true),{workUnitId:'W-1'}),error=>{
      assert.equal(error.runtimeUnavailable,true);
      assert.equal(error.nonRetryable,true);
      assert.match(error.message,/RUNTIME_CAPABILITY_UNAVAILABLE/);
      return true;
    });
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('D-019: realized capability exactly preserves a satisfiable AuthorizedGrant',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-d019-'));
  try{
    const executor=new CodexExecutor({runtimeRoot:dir,networkAccess:true,client:{}});
    const scope=executor.executionScope(task(),policy(true),{workUnitId:'W-1'});
    assert.equal(scope.projectAccess,'none');
    assert.equal(scope.networkAccess,true);
    assert.equal(scope.runtimeConfig.permissions.taskboard_runtime.network.enabled,true);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
