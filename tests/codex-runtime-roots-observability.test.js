import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexAppServerClient } from '../src/extensions/executors/codex/app-server-client.js';

test('runtime roots mismatch records requested and returned roots before failing closed', async () => {
  const diagnostics=[];
  const calls=[];
  const command=process.platform==='win32'?'C:\\fake\\codex':'/fake/codex';
  const cwd=process.platform==='win32'?'D:\\workspace':'/workspace';
  const runtimeRoot=process.platform==='win32'?'D:\\workspace\\probe':'/workspace/probe';
  const client=new CodexAppServerClient({command,diagnosticLogger:line=>diagnostics.push(line)});
  client.version='codex-cli 0.147.0';
  client.connect=async()=>{};
  client.request=async(method,params)=>{
    calls.push(method);
    if(method==='thread/start'){
      return{
        thread:{id:'thr_roots_mismatch',ephemeral:true},
        activePermissionProfile:{id:params.permissions},
        runtimeWorkspaceRoots:[],
      };
    }
    throw new Error(`unexpected RPC ${method}`);
  };

  await assert.rejects(client.runTurn({
    cwd,
    writableRoots:[],
    prompt:'diagnostic only',
    inputItems:[],
    outputSchema:{type:'object'},
    networkAccess:false,
    permissionProfile:'taskboard_runtime',
    runtimeWorkspaceRoots:[runtimeRoot],
    diagnosticContext:{taskId:'T-ROOTS',workUnitId:null,role:'diagnostic-probe'},
  }),/CODEX_RUNTIME_ROOTS_NOT_APPLIED/);

  assert.deepEqual(calls,['thread/start'],'turn/start must not run after roots confirmation mismatch');
  const events=diagnostics.map(line=>JSON.parse(line.replace(/^\[codex-runtime\] /,'')));
  const mismatch=events.find(item=>item.event==='runtime-roots-mismatch');
  assert.ok(mismatch,'roots mismatch must emit a dedicated diagnostic event');
  assert.equal(mismatch.taskId,'T-ROOTS');
  assert.equal(mismatch.workUnitId,null);
  assert.equal(mismatch.role,'diagnostic-probe');
  assert.equal(mismatch.requestedPermissionProfile,'taskboard_runtime');
  assert.equal(mismatch.activePermissionProfile,'taskboard_runtime');
  assert.deepEqual(mismatch.requestedRuntimeWorkspaceRoots,[runtimeRoot]);
  assert.deepEqual(mismatch.returnedRuntimeWorkspaceRoots,[]);
  assert.equal(mismatch.cwd,cwd);
  assert.equal(mismatch.command,command);
  assert.equal(mismatch.version,'codex-cli 0.147.0');
});
