import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EXTENSION_API_VERSION, ExtensionRegistry, OrchestrationMode } from '../src/extensions/runtime/extension-registry.js';
import { ConnectionSettingsPort } from '../src/extensions/ports/connection-settings.js';
import { SurfaceManager } from '../src/extensions/runtime/surface-manager.js';
import { ExecutorPort } from '../src/core/executor-port.js';
import { CapabilityProviderPort } from '../src/extensions/ports/capability-provider.js';
import { SurfaceHostPort } from '../src/extensions/ports/surface-host.js';

class DemoExecutor extends ExecutorPort { async execute(request){ return request; } }
class DemoCapability extends CapabilityProviderPort { async discover(){ return { discoveryLevel:'basic' }; } }
class DemoConnectionSettings extends ConnectionSettingsPort {
  describe(){return{schemaVersion:1,kind:'form',title:'Demo',fields:[]};}
  getPublic(){return{connected:true};}
  async update(){return this.getPublic();}
}
class DemoSurface extends SurfaceHostPort {
  constructor(){ super(); this.started=0; this.stopped=0; this.scanned=0; }
  start(){ this.started+=1; }
  stop(){ this.stopped+=1; }
  async scanNow(){ this.scanned+=1; return this.status(); }
  status(){ return { id:'demo-surface', state:this.started>this.stopped?'watching':'stopped', attachedTargets:0, error:null }; }
}

test('generic extension registry carries independent execution, capability, settings, presentation, orchestration and surface axes', () => {
  const registry=new ExtensionRegistry();
  registry.register('demo',()=>({
    apiVersion:EXTENSION_API_VERSION,
    displayName:'Demo',
    orchestrationMode:OrchestrationMode.TASKBOARD,
    presentation:{description:'External demo executor'},
    executor:new DemoExecutor(),
    capabilityProvider:new DemoCapability(),
    connectionSettings:new DemoConnectionSettings(),
    surfaceHosts:[new DemoSurface()],
  }));
  const extension=registry.create('demo');
  assert.equal(extension.id,'demo');
  assert.equal(extension.apiVersion,EXTENSION_API_VERSION);
  assert.equal(extension.displayName,'Demo');
  assert.equal(extension.orchestrationMode,OrchestrationMode.TASKBOARD);
  assert.equal(extension.presentation.description,'External demo executor');
  assert.ok(extension.executor instanceof ExecutorPort);
  assert.ok(extension.capabilityProvider instanceof CapabilityProviderPort);
  assert.ok(extension.connectionSettings instanceof ConnectionSettingsPort);
  assert.ok(extension.surfaceHosts[0] instanceof SurfaceHostPort);
  assert.throws(()=>registry.register('demo',()=>({})),/EXTENSION_DUPLICATE/);
});

test('executor must override the base execute placeholder before it can bind',()=>{
  class IncompleteExecutor extends ExecutorPort {}
  const registry=new ExtensionRegistry().register('incomplete',()=>({apiVersion:EXTENSION_API_VERSION,executor:new IncompleteExecutor()}));
  assert.throws(()=>registry.create('incomplete'),/EXTENSION_EXECUTOR_NOT_IMPLEMENTED:incomplete:execute/);
});

test('connection discovery is an optional fail-closed author capability',async()=>{
  const base=new DemoConnectionSettings();
  await assert.rejects(base.discover({values:{}}),/EXTENSION_CONNECTION_DISCOVERY_UNAVAILABLE/);
  class DiscoveringSettings extends DemoConnectionSettings { async discover(request){return{models:[{id:'model-a'}],received:request};} }
  const request={values:{baseUrl:'https://api.example/v1'}};
  assert.deepEqual(await new DiscoveringSettings().discover(request),{models:[{id:'model-a'}],received:request});
});

test('extension api version is explicit and fails closed before incompatible code can bind',()=>{
  const missing=new ExtensionRegistry().register('missing',()=>({executor:new DemoExecutor()}));
  assert.throws(()=>missing.create('missing'),/EXTENSION_API_VERSION_REQUIRED:missing/);
  const future=new ExtensionRegistry().register('future',()=>({apiVersion:EXTENSION_API_VERSION+1,executor:new DemoExecutor()}));
  assert.throws(()=>future.create('future'),new RegExp(`EXTENSION_API_VERSION_UNSUPPORTED:future:${EXTENSION_API_VERSION+1}`));
});

test('incomplete connection settings fail closed at the extension boundary',()=>{
  const registry=new ExtensionRegistry().register('bad-settings',()=>({apiVersion:EXTENSION_API_VERSION,executor:new DemoExecutor(),connectionSettings:{getPublic(){return{};}}}));
  assert.throws(()=>registry.create('bad-settings'),/EXTENSION_CONNECTION_SETTINGS_INVALID:bad-settings/);
});

test('runtime-native orchestration is a distinct declared mode rather than an implicit runSubagent variant',()=>{
  const registry=new ExtensionRegistry();
  registry.register('native',()=>({apiVersion:EXTENSION_API_VERSION,displayName:'Native',orchestrationMode:OrchestrationMode.RUNTIME_NATIVE,executor:new DemoExecutor()}));
  assert.equal(registry.create('native').orchestrationMode,OrchestrationMode.RUNTIME_NATIVE);
  registry.register('bad',()=>({apiVersion:EXTENSION_API_VERSION,orchestrationMode:'hybrid',executor:new DemoExecutor()}));
  assert.throws(()=>registry.create('bad'),/EXTENSION_ORCHESTRATION_MODE_INVALID:hybrid/);
});

test('TaskBoard exposes generic author and host composition entry points without concrete builtin extensions',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.exports['./extension-api'],'./src/extensions/public-api.js');
  assert.equal(pkg.exports['./extensions'],'./src/extensions/index.js');
  assert.equal(pkg.exports['./bootstrap'],'./src/server/bootstrap.js');
  const authorApi=readFileSync(new URL('../src/extensions/public-api.js',import.meta.url),'utf8');
  const hostApi=readFileSync(new URL('../src/extensions/index.js',import.meta.url),'utf8');
  assert.match(authorApi,/EXTENSION_API_VERSION/);
  assert.doesNotMatch(authorApi,/createBuiltinExtensionRegistry|ExtensionRegistry/);
  assert.match(hostApi,/ExtensionRegistry/);
  assert.doesNotMatch(hostApi,/createBuiltinExtensionRegistry|codex|mock/i);
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
