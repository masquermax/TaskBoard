import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const productIndex=readFileSync(resolve(process.cwd(),'src/server/index.js'),'utf8');
const bootstrapSource=readFileSync(resolve(process.cwd(),'src/server/bootstrap.js'),'utf8');

test('product Runtime starts from a generic registry and never wires concrete builtin extensions', () => {
  assert.match(productIndex,/new ExtensionRegistry\(\)/);
  assert.doesNotMatch(productIndex,/createBuiltinExtensionRegistry/);
  assert.doesNotMatch(productIndex,/register\(['"]codex['"]/);
  assert.doesNotMatch(productIndex,/register\(['"]mock['"]/);
});

test('product Runtime does not use environment variables or direct specs as a second extension import path', () => {
  assert.doesNotMatch(productIndex,/TASKBOARD_EXTERNAL_EXTENSIONS/);
  assert.doesNotMatch(productIndex,/TASKBOARD_EXECUTOR/);
  assert.doesNotMatch(productIndex,/externalExtensions/);
  assert.match(productIndex,/ImportedExtensionStore/);
  assert.match(productIndex,/loadRegisteredExtensions/);
});

test('bootstrap is a generic host seam, not a hidden extension installation path', () => {
  assert.match(bootstrapSource,/new ExtensionRegistry\(\)/);
  assert.doesNotMatch(bootstrapSource,/createBuiltinExtensionRegistry/);
  assert.doesNotMatch(bootstrapSource,/registerExternalExtensions/);
  assert.doesNotMatch(bootstrapSource,/TASKBOARD_EXTERNAL_EXTENSIONS/);
  assert.doesNotMatch(bootstrapSource,/TASKBOARD_EXECUTOR/);
  assert.doesNotMatch(bootstrapSource,/externalExtensions/);
  assert.doesNotMatch(bootstrapSource,/executorName\s*=\s*['"]codex['"]/);
});
