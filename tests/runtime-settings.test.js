import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DEFAULT_RUNTIME_SETTINGS, RuntimeSettingsStore, executionLimitsFromCapability, migrateRuntimeSettings, normalizeRuntimeSettings, resolveEffectiveRuntimeSettings } from '../src/core/runtime-settings.js';
import { createTestExtensionRegistry as createBuiltinExtensionRegistry } from './helpers/test-extension-registry.js';

test('simple runtime settings expose only task concurrency and per-Root maximum Subagents, persist only after user changes them',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-settings-'));
  const file=join(dir,'data/settings.json');
  try{
    const store=new RuntimeSettingsStore({file,env:{}});
    assert.deepEqual(store.get(),DEFAULT_RUNTIME_SETTINGS);
    assert.equal(existsSync(file),false,'reading defaults must not create persistence');
    store.update({taskConcurrency:3,taskMaxSubagents:5});
    assert.deepEqual(store.get(),{taskConcurrency:3,taskMaxSubagents:5});
    assert.deepEqual(JSON.parse(readFileSync(file,'utf8')),{taskConcurrency:3,taskMaxSubagents:5});
    store.update({taskConcurrency:1,taskMaxSubagents:4});
    const reloaded=new RuntimeSettingsStore({file,env:{}});
    assert.deepEqual(reloaded.get(),{taskConcurrency:1,taskMaxSubagents:4});
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('runtime settings accept only integers 1-5 and retain legacy workerConcurrency only as a migration input',()=>{
  assert.deepEqual(normalizeRuntimeSettings({taskConcurrency:99,taskMaxSubagents:0}),DEFAULT_RUNTIME_SETTINGS);
  assert.deepEqual(normalizeRuntimeSettings({taskConcurrency:5,taskMaxSubagents:1}),{taskConcurrency:5,taskMaxSubagents:1});
  assert.deepEqual(normalizeRuntimeSettings({taskConcurrency:2.5,taskMaxSubagents:'x'}),DEFAULT_RUNTIME_SETTINGS);
  assert.deepEqual(migrateRuntimeSettings({taskConcurrency:4,workerConcurrency:5}),{taskConcurrency:4,taskMaxSubagents:5});
  assert.deepEqual(migrateRuntimeSettings({taskConcurrency:3,taskMaxThreads:4}),{taskConcurrency:3,taskMaxSubagents:4});
});

test('environment values can provide initial defaults without becoming a separate user workflow',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-settings-env-'));
  try{
    const store=new RuntimeSettingsStore({file:join(dir,'settings.json'),env:{TASKBOARD_TASK_CONCURRENCY:'1',TASKBOARD_TASK_MAX_THREADS:'5'}});
    assert.deepEqual(store.get(),{taskConcurrency:1,taskMaxSubagents:5});
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('corrupt optional simple settings fall back to safe defaults instead of preventing TaskBoard startup',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-settings-corrupt-'));const file=join(dir,'settings.json');
  try{writeFileSync(file,'{bad json','utf8');const store=new RuntimeSettingsStore({file,env:{}});assert.deepEqual(store.get(),DEFAULT_RUNTIME_SETTINGS);}
  finally{rmSync(dir,{recursive:true,force:true});}
});

test('failed settings persistence does not retain an in-memory value that was never written',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-settings-fail-'));const file=join(dir,'settings-target');
  try{
    const store=new RuntimeSettingsStore({file,env:{}});
    mkdirSync(file);
    assert.throws(()=>store.update({taskConcurrency:4,taskMaxSubagents:1}));
    assert.deepEqual(store.get(),DEFAULT_RUNTIME_SETTINGS);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('unknown AI limits use configured values; only explicitly semantic limits cap the effective values',()=>{
  const configured={taskConcurrency:5,taskMaxSubagents:5};
  assert.deepEqual(resolveEffectiveRuntimeSettings(configured,null),{configured,limits:{taskConcurrency:null,taskMaxSubagents:null},effective:configured});
  const capability={execution:{limits:{taskConcurrency:3,taskMaxSubagents:4}}};
  assert.deepEqual(executionLimitsFromCapability(capability),{taskConcurrency:3,taskMaxSubagents:4});
  assert.deepEqual(resolveEffectiveRuntimeSettings(configured,capability),{configured,limits:{taskConcurrency:3,taskMaxSubagents:4},effective:{taskConcurrency:3,taskMaxSubagents:4}});
  assert.deepEqual(executionLimitsFromCapability({execution:{maxConcurrency:2,limits:{genericConcurrency:2}}}),{taskConcurrency:null,taskMaxSubagents:null},'unrelated concurrency numbers must not be guessed into either semantic setting');
});

test('applying simple settings changes live Scheduler and per-Root Subagent caps without restarting',async()=>{
  const { bootstrap } = await import('../src/server/bootstrap.js');
  const dir=mkdtempSync(join(tmpdir(),'taskboard-settings-live-'));
  try{
    const runtime=bootstrap({rootDir:dir,executorName:'mock',extensionRegistry:createBuiltinExtensionRegistry(),startScheduler:false});
    assert.equal(runtime.scheduler.maxConcurrentTasks,2);
    assert.equal(runtime.rootRuntime.maxConcurrentSubagents,3);
    const state=runtime.applyRuntimeSettings({taskConcurrency:1,taskMaxSubagents:5});
    assert.deepEqual(state.configured,{taskConcurrency:1,taskMaxSubagents:5});
    assert.deepEqual(state.effective,{taskConcurrency:1,taskMaxSubagents:5});
    assert.equal(runtime.scheduler.maxConcurrentTasks,1);
    assert.equal(runtime.rootRuntime.maxConcurrentSubagents,5);
    runtime.executor.close?.();runtime.database.close();
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('user setting updates reject values outside 1-5 instead of silently rewriting them',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-settings-range-'));
  try{
    const store=new RuntimeSettingsStore({file:join(dir,'settings.json'),env:{}});
    assert.throws(()=>store.update({taskConcurrency:6}),/RUNTIME_SETTINGS_OUT_OF_RANGE/);
    assert.throws(()=>store.update({taskMaxSubagents:0}),/RUNTIME_SETTINGS_OUT_OF_RANGE/);
    assert.deepEqual(store.get(),DEFAULT_RUNTIME_SETTINGS);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
