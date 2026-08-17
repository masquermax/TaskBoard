import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ExtensionRegistry, OrchestrationMode } from '../src/extensions/runtime/extension-registry.js';
import { SurfaceManager } from '../src/extensions/runtime/surface-manager.js';
import { ExecutorPort } from '../src/core/executor-port.js';
import { CapabilityProviderPort } from '../src/extensions/ports/capability-provider.js';
import { SurfaceHostPort } from '../src/extensions/ports/surface-host.js';

class DemoExecutor extends ExecutorPort {}
class DemoCapability extends CapabilityProviderPort { async discover(){ return { discoveryLevel:'basic' }; } }
class DemoSurface extends SurfaceHostPort {
  constructor(){ super(); this.started=0; this.stopped=0; this.scanned=0; }
  start(){ this.started+=1; }
  stop(){ this.stopped+=1; }
  async scanNow(){ this.scanned+=1; return this.status(); }
  status(){ return { id:'demo-surface', state:this.started>this.stopped?'watching':'stopped', attachedTargets:0, error:null }; }
}

test('generic extension registry carries independent execution, capability, presentation, orchestration and surface axes', () => {
  const registry=new ExtensionRegistry();
  registry.register('demo',()=>({
    displayName:'Demo',
    orchestrationMode:OrchestrationMode.TASKBOARD,
    presentation:{description:'External demo executor'},
    executor:new DemoExecutor(),
    capabilityProvider:new DemoCapability(),
    surfaceHosts:[new DemoSurface()],
  }));
  const extension=registry.create('demo');
  assert.equal(extension.id,'demo');
  assert.equal(extension.displayName,'Demo');
  assert.equal(extension.orchestrationMode,OrchestrationMode.TASKBOARD);
  assert.equal(extension.presentation.description,'External demo executor');
  assert.ok(extension.executor instanceof ExecutorPort);
  assert.ok(extension.capabilityProvider instanceof CapabilityProviderPort);
  assert.ok(extension.surfaceHosts[0] instanceof SurfaceHostPort);
  assert.throws(()=>registry.register('demo',()=>({})),/EXTENSION_DUPLICATE/);
});

test('runtime-native orchestration is a distinct declared mode rather than an implicit runSubagent variant',()=>{
  const registry=new ExtensionRegistry();
  registry.register('native',()=>({displayName:'Native',orchestrationMode:OrchestrationMode.RUNTIME_NATIVE,executor:new DemoExecutor()}));
  assert.equal(registry.create('native').orchestrationMode,OrchestrationMode.RUNTIME_NATIVE);
  registry.register('bad',()=>({orchestrationMode:'hybrid',executor:new DemoExecutor()}));
  assert.throws(()=>registry.create('bad'),/EXTENSION_ORCHESTRATION_MODE_INVALID:hybrid/);
});

test('TaskBoard exposes stable composition entry points for an external extension repository',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.exports['./extensions'],'./src/extensions/index.js');
  assert.equal(pkg.exports['./bootstrap'],'./src/server/bootstrap.js');
});

test('surface manager is generic and lifecycle-isolates optional hosts', async () => {
  const a=new DemoSurface(); const b=new DemoSurface();
  const manager=new SurfaceManager({hosts:[a,b]});
  manager.start(); manager.start();
  assert.equal(a.started,1); assert.equal(b.started,1);
  const rows=await manager.scanNow();
  assert.equal(rows.length,2); assert.equal(a.scanned,1);
  manager.stop();
  assert.equal(a.stopped,1); assert.equal(b.stopped,1);
});
