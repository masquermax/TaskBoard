import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../src/server/bootstrap.js';
import { createApp } from '../src/server/app.js';
import { ExtensionRegistry, EXTENSION_API_VERSION } from '../src/extensions/runtime/extension-registry.js';
import { TestExecutor } from './helpers/test-executor.js';

function models(){return[
  {id:'frontier',displayName:'Frontier',description:'Flagship frontier model.',reasoningEfforts:[{value:'low'},{value:'medium'},{value:'high'}]},
  {id:'balanced',displayName:'Balanced',description:'Balanced model.',reasoningEfforts:[{value:'low'},{value:'medium'},{value:'high'}]},
];}
function snapshot(providerId='provider-a',extra={}){return{schemaVersion:1,extensionId:'mock-capability',provider:{id:providerId},discoveryLevel:'full',routingSafe:true,catalogState:'fresh',execution:{ready:true},defaults:{model:'frontier'},modelSelection:{explicitPerTurn:true,maxPerTurn:1},models:models(),...extra};}
class CapabilityProvider{constructor(value){this.value=value;}snapshot(){return this.value;}async discover(){return this.value;}}
async function requestJson(url,options={}){const response=await fetch(url,options),body=await response.json();return{response,body};}

test('model-selection HTTP API keeps explicit preference scoped to current capability provenance',async()=>{
  const rootDir=mkdtempSync(join(tmpdir(),'taskboard-model-selection-api-')),provider=new CapabilityProvider(snapshot());
  const registry=new ExtensionRegistry().register('mock',()=>({apiVersion:EXTENSION_API_VERSION,id:'mock-capability',displayName:'Mock Capability',executor:new TestExecutor(),capabilityProvider:provider}));
  const runtime=bootstrap({rootDir,executorName:'mock',extensionRegistry:registry,startScheduler:false});
  const app=createApp({taskService:runtime.taskService,executor:runtime.executor,scheduler:runtime.scheduler,capabilityProvider:runtime.capabilityProvider,extension:runtime.extension,modelSelectionState:runtime.modelSelectionState,applyModelSelection:runtime.applyModelSelection,uiRoot:resolve('src/ui')});
  const server=createServer(app);await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    let result=await requestJson(`${base}/api/model-selection`);assert.equal(result.response.status,200);assert.deepEqual(result.body.modelSelection.scope,{extensionId:'mock-capability',providerId:'provider-a'});assert.deepEqual(result.body.modelSelection.selection,{mode:'auto',model:null});
    result=await requestJson(`${base}/api/model-selection`,{method:'PUT',headers:{'content-type':'application/json','x-taskboard-action':'ui'},body:JSON.stringify({mode:'specific',model:'balanced'})});assert.equal(result.response.status,200);assert.deepEqual(result.body.modelSelection.selection,{mode:'specific',model:'balanced'});

    provider.value=snapshot('provider-b');
    result=await requestJson(`${base}/api/model-selection`);assert.deepEqual(result.body.modelSelection.selection,{mode:'auto',model:null});assert.equal(result.body.modelSelection.scope.providerId,'provider-b');

    provider.value=snapshot('provider-a');
    result=await requestJson(`${base}/api/model-selection`);assert.deepEqual(result.body.modelSelection.selection,{mode:'specific',model:'balanced'});

    provider.value=snapshot('provider-a',{models:models().filter(model=>model.id!=='balanced')});
    result=await requestJson(`${base}/api/model-selection`);assert.deepEqual(result.body.modelSelection.selection,{mode:'auto',model:null});assert.equal(result.body.modelSelection.notice.model,'balanced');
  }finally{runtime.scheduler.stop();runtime.executor.close?.();await new Promise(resolveClose=>server.close(resolveClose));runtime.database.close();rmSync(rootDir,{recursive:true,force:true});}
});

test('model-selection HTTP API fails closed for explicit choice without a stable provider scope',async()=>{
  const rootDir=mkdtempSync(join(tmpdir(),'taskboard-model-selection-noscope-')),provider=new CapabilityProvider(snapshot('provider-a',{provider:null}));
  const registry=new ExtensionRegistry().register('mock',()=>({apiVersion:EXTENSION_API_VERSION,id:'mock-capability',displayName:'Mock Capability',executor:new TestExecutor(),capabilityProvider:provider}));
  const runtime=bootstrap({rootDir,executorName:'mock',extensionRegistry:registry,startScheduler:false});
  const server=createServer(createApp({taskService:runtime.taskService,executor:runtime.executor,scheduler:runtime.scheduler,capabilityProvider:runtime.capabilityProvider,extension:runtime.extension,modelSelectionState:runtime.modelSelectionState,applyModelSelection:runtime.applyModelSelection,uiRoot:resolve('src/ui')}));await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));const base=`http://127.0.0.1:${server.address().port}`;
  try{const result=await requestJson(`${base}/api/model-selection`,{method:'PUT',headers:{'content-type':'application/json','x-taskboard-action':'ui'},body:JSON.stringify({mode:'specific',model:'balanced'})});assert.equal(result.response.status,409);assert.equal(result.body.error,'MODEL_SELECTION_SCOPE_UNAVAILABLE');}
  finally{runtime.scheduler.stop();runtime.executor.close?.();await new Promise(resolveClose=>server.close(resolveClose));runtime.database.close();rmSync(rootDir,{recursive:true,force:true});}
});
