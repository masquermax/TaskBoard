import test from 'node:test';
import assert from 'node:assert/strict';
import { ExtensionRegistry } from '../src/extensions/runtime/extension-registry.js';
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

test('generic extension registry carries independent execution, capability, and surface axes', () => {
  const registry=new ExtensionRegistry();
  registry.register('demo',()=>({ displayName:'Demo', executor:new DemoExecutor(), capabilityProvider:new DemoCapability(), surfaceHosts:[new DemoSurface()] }));
  const extension=registry.create('demo');
  assert.equal(extension.id,'demo');
  assert.ok(extension.executor instanceof ExecutorPort);
  assert.ok(extension.capabilityProvider instanceof CapabilityProviderPort);
  assert.ok(extension.surfaceHosts[0] instanceof SurfaceHostPort);
  assert.throws(()=>registry.register('demo',()=>({})),/EXTENSION_DUPLICATE/);
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
