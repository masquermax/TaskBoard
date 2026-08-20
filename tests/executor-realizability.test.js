import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';

function request(networkAccess){return{instructions:'compiled',context:{},responseContract:{type:'object'},authorizedGrant:{role:'subagent',projectAccess:'none',networkAccess,environmentAccess:'none'},modelPolicy:{},runtime:{taskId:'T-D019',executionId:'W-1',workUnitId:'W-1',projectPaths:[],attachments:[]}};}

test('D-019: Executor reports UNAVAILABLE instead of silently weakening required network capability',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-d019-'));
  try{
    const executor=new CodexExecutor({runtimeRoot:dir,networkAccess:false,client:{}});
    assert.throws(()=>executor.executionScope(request(true)),error=>{
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
    const scope=executor.executionScope(request(true));
    assert.equal(scope.projectAccess,'none');
    assert.equal(scope.networkAccess,true);
    assert.equal(scope.runtimeConfig.permissions.taskboard_runtime.network.enabled,true);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
