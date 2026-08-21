import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ExtensionRegistry, EXTENSION_API_VERSION } from '../src/extensions/runtime/extension-registry.js';
import { loadRegisteredExtensions } from '../src/extensions/runtime/external-extension-loader.js';

function moduleFile(source) {
  const root=mkdtempSync(resolve(tmpdir(),'taskboard-registered-extension-'));
  const file=resolve(root,'index.cjs');
  writeFileSync(file,source,'utf8');
  return file;
}

test('registered loader loads only explicitly supplied registry entries', () => {
  const registry=new ExtensionRegistry();
  const file=moduleFile(`module.exports={id:'company-api',createExtension(){return{apiVersion:${EXTENSION_API_VERSION},executor:{}};}};`);
  const result=loadRegisteredExtensions(registry,{entries:[{id:'company-api',entryPath:file,apiVersion:EXTENSION_API_VERSION}]});
  assert.deepEqual(result.loadedIds,['company-api']);
  assert.deepEqual(result.loadErrors,{});
  assert.equal(registry.has('company-api'),true);
});

test('persisted incompatible api is reported without executing the extension entry',()=>{
  const root=mkdtempSync(resolve(tmpdir(),'taskboard-registered-extension-version-'));
  const marker=resolve(root,'executed.txt');
  const file=resolve(root,'index.cjs');
  writeFileSync(file,`require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');module.exports={id:'legacy',createExtension(){return{apiVersion:${Math.max(1,EXTENSION_API_VERSION-1)}};}};`,'utf8');
  const legacyVersion=Math.max(1,EXTENSION_API_VERSION-1);
  const registry=new ExtensionRegistry();
  const result=loadRegisteredExtensions(registry,{entries:[{id:'legacy',entryPath:file,apiVersion:legacyVersion}]});
  assert.deepEqual(result.loadedIds,[]);
  assert.equal(registry.has('legacy'),false);
  assert.equal(existsSync(marker),false);
  assert.equal(result.loadErrors.legacy,`EXTENSION_API_VERSION_UNSUPPORTED:legacy:${legacyVersion}`);
});

test('one broken registered extension is reported without preventing other registered entries from loading', () => {
  const registry=new ExtensionRegistry();
  const good=moduleFile(`module.exports={id:'good',createExtension(){return{apiVersion:${EXTENSION_API_VERSION},executor:{}};}};`);
  const missing=resolve(tmpdir(),`missing-${Date.now()}.cjs`);
  const result=loadRegisteredExtensions(registry,{entries:[{id:'broken',entryPath:missing,apiVersion:EXTENSION_API_VERSION},{id:'good',entryPath:good,apiVersion:EXTENSION_API_VERSION}]});
  assert.equal(registry.has('good'),true);
  assert.deepEqual(result.loadedIds,['good']);
  assert.match(result.loadErrors.broken,/EXTERNAL_EXTENSION_LOAD_FAILED/);
});

test('manifest id must match module descriptor id before registration', () => {
  const registry=new ExtensionRegistry();
  const file=moduleFile(`module.exports={id:'other',createExtension(){return{apiVersion:${EXTENSION_API_VERSION}};}};`);
  const result=loadRegisteredExtensions(registry,{entries:[{id:'expected',entryPath:file,apiVersion:EXTENSION_API_VERSION}]});
  assert.deepEqual(result.loadedIds,[]);
  assert.match(result.loadErrors.expected,/EXTENSION_REGISTERED_ID_MISMATCH:expected:other/);
  assert.equal(registry.has('other'),false);
});

test('persisted imports cannot use registrar modules to add undeclared extension ids', () => {
  const registry=new ExtensionRegistry();
  const file=moduleFile(`module.exports={register(registry){registry.register('hidden',()=>({apiVersion:${EXTENSION_API_VERSION}}));}};`);
  const result=loadRegisteredExtensions(registry,{entries:[{id:'declared',entryPath:file,apiVersion:EXTENSION_API_VERSION}]});
  assert.match(result.loadErrors.declared,/EXTENSION_IMPORTED_REGISTRAR_UNSUPPORTED:declared/);
  assert.deepEqual(registry.ids(),[]);
});
