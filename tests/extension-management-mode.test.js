import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ExtensionRegistry } from '../src/extensions/runtime/extension-registry.js';
import { bootstrap } from '../src/server/bootstrap.js';

test('explicit empty product registry starts in management mode instead of inventing a concrete Executor', async () => {
  const rootDir=mkdtempSync(resolve(tmpdir(),'taskboard-management-mode-'));
  const runtime=bootstrap({
    rootDir,
    executorName:null,
    extensionRegistry:new ExtensionRegistry(),
    allowMissingExecutor:true,
    startScheduler:false,
  });
  try {
    assert.equal(runtime.extension,null);
    assert.equal(runtime.extensionLoadError,null);
    assert.equal(runtime.executor.readiness().ready,false);
    const health=await runtime.executor.health();
    assert.equal(health.error,'EXECUTOR_NOT_CONFIGURED');
    const task=runtime.taskService.createTask({title:'等待扩展',instruction:'导入 Executor 后再执行'});
    assert.equal(task.status,'READY');
    await runtime.scheduler.tick();
    assert.equal(runtime.taskService.getTask(task.id).status,'READY');
  } finally {
    runtime.executor.close?.();
    runtime.database.close();
  }
});

test('invalid active Executor degrades only the product runtime to management mode', async () => {
  const rootDir=mkdtempSync(resolve(tmpdir(),'taskboard-management-mode-invalid-'));
  let unrelatedFactoryCalls=0;
  const registry=new ExtensionRegistry()
    .register('broken',()=>({apiVersion:1,executor:{async runRoot(){}}}))
    .register('unrelated',()=>{unrelatedFactoryCalls+=1;return{apiVersion:1,executor:{async execute(){return{};}}};});
  const runtime=bootstrap({
    rootDir,
    executorName:'broken',
    extensionRegistry:registry,
    allowMissingExecutor:true,
    startScheduler:false,
  });
  try {
    assert.equal(runtime.extension,null);
    assert.equal(runtime.extensionLoadError,'EXTENSION_EXECUTOR_INVALID:broken:execute');
    assert.equal(runtime.executor.readiness().ready,false);
    assert.equal(unrelatedFactoryCalls,0);
    assert.equal(registry.has('unrelated'),true);
    const health=await runtime.executor.health();
    assert.equal(health.error,'EXECUTOR_NOT_CONFIGURED');
  } finally {
    runtime.executor.close?.();
    runtime.database.close();
  }
});

test('invalid active Executor still fails closed when management fallback is not allowed', () => {
  const rootDir=mkdtempSync(resolve(tmpdir(),'taskboard-management-mode-strict-'));
  const registry=new ExtensionRegistry().register('broken',()=>({apiVersion:1,executor:{async runRoot(){}}}));
  assert.throws(()=>bootstrap({
    rootDir,
    executorName:'broken',
    extensionRegistry:registry,
    allowMissingExecutor:false,
    startScheduler:false,
  }),/EXTENSION_EXECUTOR_INVALID:broken:execute/);
});
