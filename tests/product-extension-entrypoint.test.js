import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const productIndex=readFileSync(resolve(process.cwd(),'src/server/index.js'),'utf8');

test('product Runtime starts from a generic registry and never wires concrete builtin extensions', () => {
  assert.match(productIndex,/new ExtensionRegistry\(\)/);
  assert.doesNotMatch(productIndex,/createBuiltinExtensionRegistry/);
  assert.doesNotMatch(productIndex,/register\(['"]codex['"]/);
  assert.doesNotMatch(productIndex,/register\(['"]mock['"]/);
});

test('product Runtime does not use environment variables as a second extension import path', () => {
  assert.doesNotMatch(productIndex,/TASKBOARD_EXTERNAL_EXTENSIONS/);
  assert.doesNotMatch(productIndex,/TASKBOARD_EXECUTOR/);
  assert.match(productIndex,/ImportedExtensionStore/);
  assert.match(productIndex,/loadRegisteredExtensions/);
});
