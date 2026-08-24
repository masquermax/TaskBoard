import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../src/server/bootstrap.js';
import { createTestExtensionRegistry as createBuiltinExtensionRegistry } from './helpers/test-extension-registry.js';
import { EXTENSION_API_VERSION } from '../src/extensions/runtime/extension-registry.js';
import { ContinuationPort } from '../src/extensions/ports/continuation.js';

class MemoryContinuation extends ContinuationPort {
  constructor() {
    super();
    this.values = new Map();
  }

  async health() { return { available:true, ready:true }; }
  async read({ key } = {}) { return this.values.get(String(key)) ?? null; }
  async write({ key, value } = {}) {
    this.values.set(String(key), value);
    return { written:true };
  }
}

function runtimeDir(prefix) {
  return mkdtempSync(join(tmpdir(), prefix));
}

function closeRuntime(runtime) {
  try { runtime?.scheduler?.stop?.(); } catch {}
  try { runtime?.database?.close?.(); } catch {}
  try { runtime?.executor?.close?.(); } catch {}
}

test('ExtensionRegistry rejects malformed continuation contributions', () => {
  const registry=createBuiltinExtensionRegistry().register('bad-continuation',()=>({
    apiVersion:EXTENSION_API_VERSION,
    continuation:{ read() {}, write() {} },
  }));
  assert.throws(() => registry.create('bad-continuation'), /EXTENSION_CONTINUATION_INVALID:bad-continuation/);
});

test('bootstrap binds one independent continuation Extension without changing the Executor binding', async () => {
  const rootDir=runtimeDir('taskboard-continuation-');
  const continuation=new MemoryContinuation();
  const registry=createBuiltinExtensionRegistry().register('memory-continuation',()=>({
    apiVersion:EXTENSION_API_VERSION,
    displayName:'Memory Continuation',
    continuation,
  }));
  let runtime;
  try {
    runtime=bootstrap({
      rootDir,
      dbFile:join(rootDir,'taskboard.json'),
      executorName:'mock',
      continuationName:'memory-continuation',
      extensionRegistry:registry,
      startScheduler:false,
    });

    assert.equal(runtime.extension.id,'mock');
    assert.equal(runtime.continuationExtension.id,'memory-continuation');
    assert.equal(runtime.continuation,continuation);
    await runtime.continuation.write({key:'project',value:'TaskBoard'});
    assert.equal(await runtime.continuation.read({key:'project'}),'TaskBoard');
  } finally {
    closeRuntime(runtime);
    rmSync(rootDir,{recursive:true,force:true});
  }
});

test('continuation remains optional and stock TaskBoard boots without it', () => {
  const rootDir=runtimeDir('taskboard-no-continuation-');
  let runtime;
  try {
    runtime=bootstrap({
      rootDir,
      dbFile:join(rootDir,'taskboard.json'),
      executorName:'mock',
      extensionRegistry:createBuiltinExtensionRegistry(),
      startScheduler:false,
    });
    assert.equal(runtime.extension.id,'mock');
    assert.equal(runtime.continuation,null);
    assert.equal(runtime.continuationExtension,null);
  } finally {
    closeRuntime(runtime);
    rmSync(rootDir,{recursive:true,force:true});
  }
});

test('bootstrap fails closed when the selected continuation Artifact does not provide the continuation contract', () => {
  const rootDir=runtimeDir('taskboard-bad-continuation-');
  const registry=createBuiltinExtensionRegistry().register('not-continuation',()=>({
    apiVersion:EXTENSION_API_VERSION,
    displayName:'Not Continuation',
  }));
  try {
    assert.throws(() => bootstrap({
      rootDir,
      dbFile:join(rootDir,'taskboard.json'),
      executorName:'mock',
      continuationName:'not-continuation',
      extensionRegistry:registry,
      startScheduler:false,
    }),/EXTENSION_HAS_NO_CONTINUATION:not-continuation/);
  } finally {
    rmSync(rootDir,{recursive:true,force:true});
  }
});
