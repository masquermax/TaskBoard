import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ExtensionRegistry } from '../src/extensions/runtime/extension-registry.js';
import {
  configuredExternalExtensionSpecs,
  registerExternalExtensions,
} from '../src/extensions/runtime/external-extension-loader.js';

function tempModule(source) {
  const root = mkdtempSync(resolve(tmpdir(), 'taskboard-extension-'));
  const file = resolve(root, 'extension.cjs');
  writeFileSync(file, source, 'utf8');
  return { root, file };
}

test('external extension specs are explicit and semicolon-delimited', () => {
  assert.deepEqual(configuredExternalExtensionSpecs(' one ; ; two '), ['one', 'two']);
  assert.deepEqual(configuredExternalExtensionSpecs(''), []);
});

test('external extension module registers through the generic registry contract', () => {
  const { root, file } = tempModule(`
    module.exports = {
      id: 'external-test',
      createExtension(context) {
        return {
          displayName: 'External Test',
          executor: { health: async () => ({ executor: 'external-test', available: true }) },
          capabilityProvider: null,
          surfaceHosts: [],
          marker: context.marker
        };
      }
    };
  `);
  const registry = new ExtensionRegistry();
  registerExternalExtensions(registry, { rootDir: root, specs: [file] });
  assert.equal(registry.has('external-test'), true);
  const created = registry.create('external-test', { marker: 'ok' });
  assert.equal(created.id, 'external-test');
  assert.equal(created.displayName, 'External Test');
  assert.equal(typeof created.executor.health, 'function');
});

test('external extension can register multiple factories without TaskBoard knowing their ids', () => {
  const { root, file } = tempModule(`
    module.exports = {
      register(registry) {
        registry.register('alpha-external', () => ({ executor: { health: async () => ({}) } }));
        registry.register('beta-external', () => ({ executor: { health: async () => ({}) } }));
      }
    };
  `);
  const registry = new ExtensionRegistry();
  registerExternalExtensions(registry, { rootDir: root, specs: file });
  assert.deepEqual(registry.ids(), ['alpha-external', 'beta-external']);
});

test('invalid or duplicate external extensions fail closed', () => {
  const missing = tempModule(`module.exports = { id: 'broken' };`);
  assert.throws(
    () => registerExternalExtensions(new ExtensionRegistry(), { rootDir: missing.root, specs: [missing.file] }),
    /EXTERNAL_EXTENSION_FACTORY_REQUIRED:broken/,
  );

  const duplicate = tempModule(`module.exports = { id: 'same', createExtension() { return {}; } };`);
  const registry = new ExtensionRegistry().register('same', () => ({}));
  assert.throws(
    () => registerExternalExtensions(registry, { rootDir: duplicate.root, specs: [duplicate.file] }),
    /EXTENSION_DUPLICATE:same/,
  );
});
