import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ImportedExtensionStore, inspectImportedExtensionDirectory } from '../src/extensions/runtime/imported-extension-store.js';

function createUiExtension(root,id,{ui=true}={}){
  const dir=join(root,id);mkdirSync(join(dir,'src'),{recursive:true});mkdirSync(join(dir,'ui'),{recursive:true});
  writeFileSync(join(dir,'src','index.js'),`export const id=${JSON.stringify(id)}; export const createExtension=()=>({apiVersion:2}); export default {id,createExtension};\n`);
  writeFileSync(join(dir,'ui','index.html'),'<!doctype html><title>UI</title>');
  writeFileSync(join(dir,'package.json'),JSON.stringify({name:id,type:'module',main:'src/index.js',taskboard:{id,apiVersion:2,entry:'src/index.js',uiRoot:'ui',provides:{ui}}},null,2));
  return dir;
}

test('system extension root is scanned one level and one UI is selected automatically',()=>{
  const root=mkdtempSync(join(tmpdir(),'taskboard-ui-host-'));
  try{
    const system=join(root,'data','extensions');mkdirSync(system,{recursive:true});createUiExtension(system,'ui-one');
    const store=new ImportedExtensionStore({file:join(root,'registry.json'),rootDir:root});const result=store.discoverRoots([system]);
    assert.equal(result.discovered.length,1);assert.equal(store.activeUiId(),'ui-one');
    const item=store.entries()[0];assert.equal(item.provides.ui,true);assert.ok(item.uiRoot.endsWith(join('ui-one','ui')));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('multiple discovered UIs do not invent a default choice',()=>{
  const root=mkdtempSync(join(tmpdir(),'taskboard-ui-host-'));
  try{
    const system=join(root,'extensions');mkdirSync(system,{recursive:true});createUiExtension(system,'ui-a');createUiExtension(system,'ui-b');
    const store=new ImportedExtensionStore({file:join(root,'registry.json'),rootDir:root});store.discoverRoots([system]);
    assert.equal(store.activeUiId(),null);store.setActiveUi('ui-b');assert.equal(store.activeUiId(),'ui-b');store.setActiveUi(null);assert.equal(store.activeUiId(),null);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('removing a system UI directory really unplugs it and clears the active binding',()=>{
  const root=mkdtempSync(join(tmpdir(),'taskboard-ui-host-'));
  try{
    const system=join(root,'extensions');mkdirSync(system,{recursive:true});const dir=createUiExtension(system,'ui-one');
    const store=new ImportedExtensionStore({file:join(root,'registry.json'),rootDir:root});store.discoverRoots([system]);assert.equal(store.activeUiId(),'ui-one');
    rmSync(dir,{recursive:true,force:true});const result=store.discoverRoots([system]);
    assert.deepEqual(result.removedIds,['ui-one']);assert.equal(store.activeUiId(),null);assert.deepEqual(store.entries(),[]);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('an invalid system UI fails closed instead of loading stale registry metadata',()=>{
  const root=mkdtempSync(join(tmpdir(),'taskboard-ui-host-'));
  try{
    const system=join(root,'extensions');mkdirSync(system,{recursive:true});const dir=createUiExtension(system,'ui-one');
    const store=new ImportedExtensionStore({file:join(root,'registry.json'),rootDir:root});store.discoverRoots([system]);assert.equal(store.activeUiId(),'ui-one');
    writeFileSync(join(dir,'package.json'),'{ broken json');const result=store.discoverRoots([system]);
    assert.equal(store.activeUiId(),null);assert.deepEqual(store.entries(),[]);assert.ok(Object.values(result.errors).includes('EXTENSION_IMPORT_MANIFEST_INVALID'));
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('system discovery refreshes manifest metadata in place',()=>{
  const root=mkdtempSync(join(tmpdir(),'taskboard-ui-host-'));
  try{
    const system=join(root,'extensions');mkdirSync(system,{recursive:true});const dir=createUiExtension(system,'ui-one');
    const store=new ImportedExtensionStore({file:join(root,'registry.json'),rootDir:root});store.discoverRoots([system]);
    const pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));pkg.taskboard.displayName='TaskBoard UI Next';writeFileSync(join(dir,'package.json'),JSON.stringify(pkg,null,2));
    const result=store.discoverRoots([system]);assert.deepEqual(result.updated.map(item=>item.id),['ui-one']);assert.equal(store.entries()[0].displayName,'TaskBoard UI Next');
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('UI manifest must keep its static root inside the extension and contain index.html',()=>{
  const root=mkdtempSync(join(tmpdir(),'taskboard-ui-host-'));
  try{
    const dir=createUiExtension(root,'bad-ui');const pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));pkg.taskboard.uiRoot='../outside';writeFileSync(join(dir,'package.json'),JSON.stringify(pkg));
    assert.throws(()=>inspectImportedExtensionDirectory(dir,{rootDir:root}),/EXTENSION_UI_ROOT_OUTSIDE_DIRECTORY|EXTENSION_UI_ROOT_NOT_FOUND/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('manual UI import selects it when no UI is active',()=>{
  const root=mkdtempSync(join(tmpdir(),'taskboard-ui-host-'));
  try{
    const dir=createUiExtension(root,'manual-ui');const store=new ImportedExtensionStore({file:join(root,'registry.json'),rootDir:root});const item=store.importDirectory(dir);
    assert.equal(item.source,'manual');assert.equal(store.activeUiId(),'manual-ui');
  }finally{rmSync(root,{recursive:true,force:true});}
});
