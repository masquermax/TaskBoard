import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExtensionRegistry, EXTENSION_API_VERSION, OrchestrationMode } from '../src/extensions/runtime/extension-registry.js';
import { createMockExtension } from '../src/extensions/builtins/mock-extension.js';
import { bootstrap } from '../src/server/bootstrap.js';
import { AutomationPort } from '../src/extensions/ports/automation.js';

function automationExtension(automation){
  return {
    apiVersion:EXTENSION_API_VERSION,
    displayName:'Recorder Fixture',
    orchestrationMode:OrchestrationMode.TASKBOARD,
    automation,
  };
}

test('AutomationPort remains an optional public extension contract', async()=>{
  const port=new AutomationPort();
  assert.equal(port.describe().kind,'automation');
  assert.deepEqual(await port.list(),[]);
  await assert.rejects(()=>port.record(),/AUTOMATION_RECORD_UNSUPPORTED/);
  await assert.rejects(()=>port.run(),/AUTOMATION_RUN_UNSUPPORTED/);
});

test('ExtensionRegistry validates automation without granting executor semantics',()=>{
  const registry=new ExtensionRegistry().register('recorder',()=>automationExtension({describe(){return{};},async run(){return{ok:true};}}));
  const extension=registry.create('recorder');
  assert.equal(typeof extension.automation.run,'function');
  assert.equal(extension.executor,null);
  assert.throws(()=>new ExtensionRegistry().register('bad',()=>automationExtension({describe(){return{};}})).create('bad'),/EXTENSION_AUTOMATION_INVALID:bad/);
});

test('bootstrap binds automation independently and stock execution survives absence',()=>{
  const root=mkdtempSync(join(tmpdir(),'taskboard-automation-'));
  try{
    const automation={describe(){return{title:'Fixture'};},async list(){return[{id:'one'}];},async run(){return{status:'passed'};}};
    const registry=new ExtensionRegistry()
      .register('mock',createMockExtension)
      .register('recorder',()=>automationExtension(automation));
    const runtime=bootstrap({rootDir:root,executorName:'mock',automationName:'recorder',extensionRegistry:registry,startScheduler:false});
    assert.equal(runtime.extension.id,'mock');
    assert.equal(runtime.automationExtension.id,'recorder');
    assert.equal(runtime.automation,automation);
    runtime.database.close();

    const stock=bootstrap({rootDir:root,executorName:'mock',extensionRegistry:registry,startScheduler:false});
    assert.equal(stock.extension.id,'mock');
    assert.equal(stock.automation,null);
    stock.database.close();
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('bootstrap fails closed when selected artifact has no automation facet',()=>{
  const root=mkdtempSync(join(tmpdir(),'taskboard-automation-missing-'));
  try{
    const registry=new ExtensionRegistry().register('mock',createMockExtension);
    assert.throws(()=>bootstrap({rootDir:root,executorName:'mock',automationName:'mock',extensionRegistry:registry,startScheduler:false}),/EXTENSION_HAS_NO_AUTOMATION:mock/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
