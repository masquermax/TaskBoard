import test from 'node:test';
import assert from 'node:assert/strict';
import { extensionLoadPresentation, presentExtensionLoadState } from '../src/server/extension-load-presentation.js';

test('extension load presentation separates version, executor contract and startup failures',()=>{
  assert.equal(extensionLoadPresentation('EXTENSION_API_VERSION_UNSUPPORTED:company-api:1'),'版本不兼容 · EXTENSION_API_VERSION_UNSUPPORTED:company-api:1');
  assert.equal(extensionLoadPresentation('EXTENSION_EXECUTOR_INVALID:company-api:execute'),'接口不兼容 · EXTENSION_EXECUTOR_INVALID:company-api:execute');
  assert.equal(extensionLoadPresentation('EXTENSION_EXECUTOR_NOT_IMPLEMENTED:minimal-executor:execute'),'接口不兼容 · EXTENSION_EXECUTOR_NOT_IMPLEMENTED:minimal-executor:execute');
  assert.equal(extensionLoadPresentation('EXTERNAL_EXTENSION_LOAD_FAILED:D:/broken/index.cjs'),'启动失败 · EXTERNAL_EXTENSION_LOAD_FAILED:D:/broken/index.cjs');
  assert.equal(extensionLoadPresentation(''),null);
});

test('management presentation does not mutate raw extension load diagnostics',()=>{
  const raw={loadedIds:['good'],loadErrors:{legacy:'EXTENSION_API_VERSION_UNSUPPORTED:legacy:1'}};
  const presented=presentExtensionLoadState(raw);
  assert.deepEqual(presented,{loadedIds:['good'],loadErrors:{legacy:'版本不兼容 · EXTENSION_API_VERSION_UNSUPPORTED:legacy:1'}});
  assert.deepEqual(raw,{loadedIds:['good'],loadErrors:{legacy:'EXTENSION_API_VERSION_UNSUPPORTED:legacy:1'}});
  presented.loadedIds.push('other');
  assert.deepEqual(raw.loadedIds,['good']);
});
