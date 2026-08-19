import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { ImportedExtensionStore } from '../src/extensions/runtime/imported-extension-store.js';

function extensionDirectory({ id='company-api', displayName='Company API', executor=true, source='module.exports={id:"company-api",createExtension(){return{apiVersion:1};}};' }={}) {
  const directory=mkdtempSync(resolve(tmpdir(),'taskboard-import-extension-'));
  writeFileSync(resolve(directory,'package.json'),JSON.stringify({
    name:`taskboard-extension-${id}`,
    main:'index.cjs',
    taskboard:{apiVersion:1,id,displayName,entry:'index.cjs',provides:{executor}},
  },null,2));
  writeFileSync(resolve(directory,'index.cjs'),source,'utf8');
  return directory;
}

test('import registers only the explicitly supplied directory without executing extension code', () => {
  const root=mkdtempSync(resolve(tmpdir(),'taskboard-extension-registry-'));
  const marker=resolve(root,'executed.txt');
  const directory=extensionDirectory({source:`require('node:fs').writeFileSync(${JSON.stringify(marker)},'executed');module.exports={id:'company-api',createExtension(){return{apiVersion:1};}};`});
  const store=new ImportedExtensionStore({file:resolve(root,'registry.json'),rootDir:root});
  const entry=store.importDirectory(directory);
  assert.equal(entry.id,'company-api');
  assert.equal(entry.directory,directory);
  assert.equal(existsSync(marker),false);
  assert.equal(store.entries().length,1);
});

test('first imported Executor becomes the persisted active Executor candidate', () => {
  const root=mkdtempSync(resolve(tmpdir(),'taskboard-extension-registry-'));
  const store=new ImportedExtensionStore({file:resolve(root,'registry.json'),rootDir:root});
  store.importDirectory(extensionDirectory({id:'cap-only',displayName:'Capability Only',executor:false,source:"module.exports={id:'cap-only',createExtension(){return{apiVersion:1};}};"}));
  assert.equal(store.activeExecutorId(),null);
  store.importDirectory(extensionDirectory());
  assert.equal(store.activeExecutorId(),'company-api');
  const reloaded=new ImportedExtensionStore({file:resolve(root,'registry.json'),rootDir:root});
  assert.equal(reloaded.activeExecutorId(),'company-api');
});

test('public state distinguishes pending restart, loaded, and load failure', () => {
  const root=mkdtempSync(resolve(tmpdir(),'taskboard-extension-registry-'));
  const store=new ImportedExtensionStore({file:resolve(root,'registry.json'),rootDir:root});
  store.importDirectory(extensionDirectory());
  assert.equal(store.publicState().extensions[0].status,'pending-restart');
  assert.equal(store.publicState({loadedIds:['company-api']}).extensions[0].status,'loaded');
  const failed=store.publicState({loadErrors:{'company-api':'EXTERNAL_EXTENSION_LOAD_FAILED'}}).extensions[0];
  assert.equal(failed.status,'load-failed');
  assert.equal(failed.error,'EXTERNAL_EXTENSION_LOAD_FAILED');
});

test('invalid manifests fail before registry persistence', () => {
  const root=mkdtempSync(resolve(tmpdir(),'taskboard-extension-registry-'));
  const directory=mkdtempSync(resolve(tmpdir(),'taskboard-invalid-extension-'));
  writeFileSync(resolve(directory,'package.json'),JSON.stringify({name:'not-an-extension'}));
  const store=new ImportedExtensionStore({file:resolve(root,'registry.json'),rootDir:root});
  assert.throws(()=>store.importDirectory(directory),/EXTENSION_IMPORT_MANIFEST_REQUIRED/);
  assert.deepEqual(store.entries(),[]);
});
