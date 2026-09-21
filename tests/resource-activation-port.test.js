import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bootstrap } from '../src/server/bootstrap.js';
import { ExtensionRegistry, EXTENSION_API_VERSION, OrchestrationMode } from '../src/extensions/runtime/extension-registry.js';

function tempRoot(){return mkdtempSync(join(tmpdir(),'taskboard-resource-activation-'));}

function executorExtension(capture){
  return {
    apiVersion:EXTENSION_API_VERSION,
    displayName:'Fake Executor',
    orchestrationMode:OrchestrationMode.TASKBOARD,
    executor:{
      async runRoot(request){capture.push(request);return {kind:'complete',summary:'ok'};},
      cleanupTaskWorkspace(){return true;},
    },
    surfaceHosts:[],
  };
}

function makeRegistry({capture,resourceActivation}){
  const registry=new ExtensionRegistry();
  registry.register('fake-executor',()=>executorExtension(capture));
  registry.register('resources',()=>({
    apiVersion:EXTENSION_API_VERSION,
    displayName:'Resource Hints',
    orchestrationMode:OrchestrationMode.TASKBOARD,
    resourceActivation,
    surfaceHosts:[],
  }));
  return registry;
}

test('resource activation is injected automatically into Root context as non-authoritative route hints',async()=>{
  const capture=[];
  const calls=[];
  const root=tempRoot();
  const registry=makeRegistry({capture,resourceActivation:{
    async activate(request){
      calls.push(request);
      return {
        project:'landray-ekp',
        consideredKinds:['reality','experience','method'],
        activated:[
          {kind:'reality',owner:'masquermax/Landray-EKP',entry:'README.md -> CURRENT.md',reason:'current project Reality'},
          {kind:'experience',owner:'masquermax/AI-Evidence/PROJECTS/Landray-EKP',entry:'matching CASE/RUN only',reason:'prior empirical evidence'},
        ],
      };
    },
  }});
  const runtime=bootstrap({rootDir:root,executorName:'fake-executor',resourceActivationName:'resources',extensionRegistry:registry,startScheduler:false});
  try{
    await runtime.executor.runRoot({
      task:{id:'t1',title:'Search failure',instruction:'排查蓝凌 OA 搜索失败',projectScopes:[],references:[]},
      activeWork:[],
      authorityHandoff:false,
      policyContext:{prompt:'BASE POLICY'},
    });
    assert.equal(calls.length,1);
    assert.equal(calls[0].goal,'排查蓝凌 OA 搜索失败');
    assert.equal(capture.length,1);
    const prompt=capture[0].policyContext.prompt;
    assert.match(prompt,/BASE POLICY/);
    assert.match(prompt,/NON-AUTHORITATIVE RESOURCE ACTIVATION/);
    assert.match(prompt,/masquermax\/Landray-EKP/);
    assert.match(prompt,/NOT Evidence, Claims, Runtime truth, or capability grants/);
  }finally{runtime.database.close();rmSync(root,{recursive:true,force:true});}
});

test('resource activation failure is fail-open and does not block Root execution',async()=>{
  const capture=[];
  const root=tempRoot();
  const registry=makeRegistry({capture,resourceActivation:{async activate(){throw new Error('offline');}}});
  const runtime=bootstrap({rootDir:root,executorName:'fake-executor',resourceActivationName:'resources',extensionRegistry:registry,startScheduler:false});
  try{
    await runtime.executor.runRoot({task:{id:'t2',title:'Tiny task',instruction:'fix typo'},policyContext:{prompt:'BASE'}});
    assert.equal(capture.length,1);
    assert.equal(capture[0].policyContext.prompt,'BASE');
  }finally{runtime.database.close();rmSync(root,{recursive:true,force:true});}
});

test('extension registry rejects malformed resource activation providers',()=>{
  const registry=new ExtensionRegistry();
  registry.register('bad',()=>({apiVersion:EXTENSION_API_VERSION,orchestrationMode:OrchestrationMode.TASKBOARD,resourceActivation:{},surfaceHosts:[]}));
  assert.throws(()=>registry.create('bad'),/EXTENSION_RESOURCE_ACTIVATION_INVALID:bad/);
});
