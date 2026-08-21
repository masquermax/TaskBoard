import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../src/server/bootstrap.js';
import { EXTENSION_API_VERSION, ExtensionRegistry, OrchestrationMode } from '../src/extensions/runtime/extension-registry.js';
import { ExecutorPort } from '../src/core/executor-port.js';
import { CapabilityProviderPort, basicCapabilitySnapshot } from '../src/extensions/ports/capability-provider.js';

class ExternalExecutor extends ExecutorPort {
  async health(){return{executor:'external',displayName:'External',available:true,connected:true,ready:true};}
  async execute(request){return request;}
}
class ExternalCapability extends CapabilityProviderPort {
  constructor(){super();this.current=basicCapabilitySnapshot({extensionId:'external',displayName:'External',version:'test'});}
  async discover(){return this.current;}
  snapshot(){return this.current;}
}

function externalRegistry(mode=OrchestrationMode.TASKBOARD){
  return new ExtensionRegistry().register('external',()=>({
    apiVersion:EXTENSION_API_VERSION,
    displayName:'External',
    orchestrationMode:mode,
    executor:new ExternalExecutor(),
    capabilityProvider:new ExternalCapability(),
    surfaceHosts:[],
  }));
}

test('bootstrap accepts an externally composed extension registry without changing TaskBoard Core',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-external-extension-'));
  let runtime=null;
  try{
    runtime=bootstrap({rootDir:dir,dbFile:join(dir,'taskboard.json'),executorName:'external',extensionRegistry:externalRegistry(),startScheduler:false});
    assert.equal(runtime.extension.id,'external');
    assert.equal(runtime.extension.apiVersion,EXTENSION_API_VERSION);
    assert.equal(runtime.extension.displayName,'External');
    assert.equal(runtime.extension.orchestrationMode,OrchestrationMode.TASKBOARD);
    assert.equal(runtime.extensionRegistry.has('external'),true);
  }finally{
    try{runtime?.database?.close?.();}catch{}
    rmSync(dir,{recursive:true,force:true});
  }
});

test('current bootstrap fails closed when a runtime-native extension is inserted into the TaskBoard-owned orchestration path',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-native-extension-'));
  try{
    assert.throws(()=>bootstrap({rootDir:dir,dbFile:join(dir,'taskboard.json'),executorName:'external',extensionRegistry:externalRegistry(OrchestrationMode.RUNTIME_NATIVE),startScheduler:false}),/EXTENSION_ORCHESTRATION_MODE_UNSUPPORTED:runtime-native/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
