import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { verifyCustomProviderAcceptance } from '../src/extensions/executors/codex/provider-acceptance.js';

test('provider acceptance executes one isolated no-network Turn against the selected model',async()=>{
  const calls=[];
  const result=await verifyCustomProviderAcceptance({
    execClient:{async runTurn(request){calls.push(request);return '{"ok":true}';}},
    model:'company-model',
  });
  assert.deepEqual(result,{ok:true,model:'company-model'});
  assert.equal(calls.length,1);
  const request=calls[0];
  assert.equal(request.model,'company-model');
  assert.equal(request.permissionProfile,'taskboard_connection_probe');
  assert.equal(request.networkAccess,false);
  assert.equal(request.runtimeWorkspaceRoots.length,1);
  assert.equal(request.runtimeWorkspaceRoots[0],request.cwd);
  assert.equal(request.diagnosticContext?.role,'connection-probe');
  assert.equal(request.diagnosticContext?.routeReason,'connection-apply');
  assert.equal(request.outputSchema?.properties?.ok?.const,true);
  assert.equal(existsSync(request.cwd),false,'acceptance workspace must be removed after the probe');
});

test('provider acceptance fails before execution when no concrete model is supplied',async()=>{
  let calls=0;
  await assert.rejects(
    verifyCustomProviderAcceptance({execClient:{async runTurn(){calls+=1;}},model:''}),
    error=>error?.message==='CODEX_PROVIDER_ACCEPTANCE_MODEL_REQUIRED'&&error?.nonRetryable===true,
  );
  assert.equal(calls,0);
});

test('provider acceptance rejects a successful transport that does not return the acceptance contract',async()=>{
  await assert.rejects(
    verifyCustomProviderAcceptance({execClient:{async runTurn(){return 'not-json';}},model:'company-model'}),
    error=>error?.message==='CODEX_PROVIDER_ACCEPTANCE_INVALID_RESULT'&&error?.nonRetryable===true,
  );
  await assert.rejects(
    verifyCustomProviderAcceptance({execClient:{async runTurn(){return '{"ok":false}';}},model:'company-model'}),
    error=>error?.message==='CODEX_PROVIDER_ACCEPTANCE_REJECTED'&&error?.nonRetryable===true,
  );
});

test('provider acceptance fails closed when no exec transport exists',async()=>{
  await assert.rejects(
    verifyCustomProviderAcceptance({execClient:null,model:'company-model'}),
    error=>error?.message==='CODEX_PROVIDER_ACCEPTANCE_TRANSPORT_UNAVAILABLE'&&error?.nonRetryable===true,
  );
});
