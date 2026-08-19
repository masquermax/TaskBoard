import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ExtensionRegistry, EXTENSION_API_VERSION } from '../src/extensions/runtime/extension-registry.js';
import {
  configuredExternalExtensionSpecs,
  discoveredExternalExtensionSpecs,
  registerExternalExtensions,
} from '../src/extensions/runtime/external-extension-loader.js';
import { bootstrap } from '../src/server/bootstrap.js';

function tempModule(source) {
  const root = mkdtempSync(resolve(tmpdir(), 'taskboard-extension-'));
  const file = resolve(root, 'extension.cjs');
  writeFileSync(file, source, 'utf8');
  return { root, file };
}

function taskboardExtensionBody(displayName, executorName) {
  return `{
    apiVersion: ${EXTENSION_API_VERSION},
    displayName: '${displayName}',
    executor: {
      readiness() { return { ready: true, preparing: false, reason: null, message: null }; },
      async health() { return { executor: '${executorName}', available: true, ready: true }; },
      cleanupTaskWorkspace() { return false; },
      close() {}
    },
    capabilityProvider: null,
    surfaceHosts: []
  }`;
}

test('external extension specs are explicit and semicolon-delimited', () => {
  assert.deepEqual(configuredExternalExtensionSpecs(' one ; ; two '), ['one', 'two']);
  assert.deepEqual(configuredExternalExtensionSpecs(''), []);
});

test('installed extensions are discovered only from data/extensions child entrypoints', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'taskboard-installed-extension-'));
  const installed = resolve(root, 'data/extensions/company-api');
  const ignored = resolve(root, 'data/extensions/not-an-extension');
  mkdirSync(installed, { recursive: true });
  mkdirSync(ignored, { recursive: true });
  writeFileSync(resolve(installed, 'index.cjs'), 'module.exports={};', 'utf8');
  assert.deepEqual(discoveredExternalExtensionSpecs({ rootDir: root }), [resolve(installed, 'index.cjs')]);
});

test('no external specs preserve an injected registry without requiring a registration surface', () => {
  const registry = { create() {}, has() { return false; } };
  assert.equal(registerExternalExtensions(registry, { specs: [] }), registry);
});

test('external extension module registers through the v0.9.2 generic registry contract', () => {
  const { root, file } = tempModule(`
    module.exports = {
      id: 'external-test',
      createExtension() {
        return ${taskboardExtensionBody('External Test', 'external-test')};
      }
    };
  `);
  const registry = new ExtensionRegistry();
  registerExternalExtensions(registry, { rootDir: root, specs: [file] });
  assert.equal(registry.has('external-test'), true);
  const created = registry.create('external-test');
  assert.equal(created.id, 'external-test');
  assert.equal(created.apiVersion, EXTENSION_API_VERSION);
  assert.equal(created.displayName, 'External Test');
  assert.equal(created.orchestrationMode, 'taskboard');
});

test('bootstrap can select an explicit external Executor without changing Task Core', () => {
  const { root, file } = tempModule(`
    module.exports = {
      id: 'external-bootstrap',
      createExtension() {
        return ${taskboardExtensionBody('External Bootstrap', 'external-bootstrap')};
      }
    };
  `);
  const runtime = bootstrap({
    rootDir: root,
    executorName: 'external-bootstrap',
    externalExtensions: [file],
    startScheduler: false,
  });
  try {
    assert.equal(runtime.extension.id, 'external-bootstrap');
    assert.equal(runtime.extension.apiVersion, EXTENSION_API_VERSION);
    assert.equal(runtime.extension.displayName, 'External Bootstrap');
    assert.equal(runtime.extensionRegistry.has('codex'), true);
    assert.equal(runtime.extensionRegistry.has('mock'), true);
  } finally {
    runtime.executor.close?.();
    runtime.database.close();
  }
});

test('an installed external extension may explicitly become the default Executor without environment variables', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'taskboard-default-extension-'));
  const folder = resolve(root, 'data/extensions/company-api');
  mkdirSync(folder, { recursive: true });
  writeFileSync(resolve(folder, 'index.cjs'), `
    module.exports = {
      id: 'company-api',
      defaultExecutor: true,
      createExtension() { return ${taskboardExtensionBody('Company API', 'company-api')}; }
    };
  `, 'utf8');
  const runtime = bootstrap({ rootDir: root, startScheduler: false });
  try {
    assert.equal(runtime.extension.id, 'company-api');
    assert.equal(runtime.extension.displayName, 'Company API');
  } finally {
    runtime.executor.close?.();
    runtime.database.close();
  }
});

test('multiple installed default Executors fail closed instead of choosing by filesystem order', () => {
  const root = mkdtempSync(resolve(tmpdir(), 'taskboard-ambiguous-extension-'));
  for (const id of ['alpha', 'beta']) {
    const folder = resolve(root, `data/extensions/${id}`);
    mkdirSync(folder, { recursive: true });
    writeFileSync(resolve(folder, 'index.cjs'), `module.exports={id:'${id}',defaultExecutor:true,createExtension(){return ${taskboardExtensionBody(id, id)};}};`, 'utf8');
  }
  assert.throws(() => bootstrap({ rootDir: root, startScheduler: false }), /EXTENSION_DEFAULT_EXECUTOR_AMBIGUOUS/);
});

test('external extension can register multiple factories without TaskBoard knowing their ids', () => {
  const { root, file } = tempModule(`
    module.exports = {
      register(registry) {
        registry.register('alpha-external', () => (${taskboardExtensionBody('Alpha', 'alpha-external')}));
        registry.register('beta-external', () => (${taskboardExtensionBody('Beta', 'beta-external')}));
      }
    };
  `);
  const registry = new ExtensionRegistry();
  registerExternalExtensions(registry, { rootDir: root, specs: file });
  assert.deepEqual(registry.ids(), ['alpha-external', 'beta-external']);
  assert.equal(registry.create('alpha-external').apiVersion, EXTENSION_API_VERSION);
});

test('invalid or duplicate external extensions fail closed', () => {
  const missing = tempModule(`module.exports = { id: 'broken' };`);
  assert.throws(
    () => registerExternalExtensions(new ExtensionRegistry(), { rootDir: missing.root, specs: [missing.file] }),
    /EXTERNAL_EXTENSION_FACTORY_REQUIRED:broken/,
  );

  const duplicate = tempModule(`module.exports = { id: 'same', createExtension() { return { apiVersion: 1 }; } };`);
  const registry = new ExtensionRegistry().register('same', () => ({ apiVersion: 1 }));
  assert.throws(
    () => registerExternalExtensions(registry, { rootDir: duplicate.root, specs: [duplicate.file] }),
    /EXTENSION_DUPLICATE:same/,
  );
});
