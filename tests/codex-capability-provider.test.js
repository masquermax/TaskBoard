import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexCapabilityProvider } from '../src/extensions/capabilities/codex/codex-capability-provider.js';

class FakeClient {
  static probe(){ return { available:true, version:'codex-fake 9.9', error:null }; }
  constructor(handler){ this.handler=handler; this.initialized=true; this.connectionGeneration=1; this.command='codex-fake'; this.calls=[]; }
  async connect(){ this.initialized=true; }
  async request(method,params){ this.calls.push({method,params}); return this.handler(method,params,this); }
}
function unsupported(message='Method not found'){const e=new Error(message);e.rpcCode=-32601;return e;}
function fullHandler(method,params){
  if(method==='account/read')return {account:{type:'chatgpt',planType:'plus'},requiresOpenaiAuth:true};
  if(method==='config/read')return {config:{model_provider:'openai',model:'model-b',model_reasoning_effort:'medium'}};
  if(method==='model/list')return {data:[
    {id:'model-a',supportedReasoningEfforts:[{effort:'low'},{effort:'medium'}]},
    {id:'model-b',supportedReasoningEfforts:[{effort:'medium'},{effort:'high'},{effort:'ultra-custom'}],multiAgentVersion:'v2'},
  ]};
  if(method==='modelProvider/capabilities/read')return {supportsWebSearch:true,apiKey:'must-not-leak',nested:{access_token:'must-not-leak-either',safe:true}};
  throw unsupported();
}

test('Codex startup discovery is lightweight; explicit refresh upgrades the cached model catalog', async () => {
  const client=new FakeClient(fullHandler); const provider=new CodexCapabilityProvider({client});
  const startup=await provider.initialize({backgroundRefresh:false});
  assert.equal(startup.discoveryLevel,'partial');
  assert.equal(startup.defaults.model,'model-b');
  assert.deepEqual(startup.models,[]);
  assert.equal(client.calls.some(x=>x.method==='model/list'),false,'startup must not block on model/list');
  const refreshed=await provider.refresh({reason:'test',manual:true});
  assert.equal(refreshed.refreshed,true);
  const snapshot=refreshed.capability;
  assert.equal(snapshot.discoveryLevel,'full');
  assert.equal(snapshot.execution.ready,true);
  assert.equal(snapshot.provider.id,'openai');
  assert.equal(snapshot.provider.authMode,'chatgpt');
  assert.equal(snapshot.provider.planType,'plus');
  assert.equal(snapshot.defaults.model,'model-b');
  assert.deepEqual(snapshot.models[1].reasoningEfforts.map(x=>x.value),['medium','high','ultra-custom']);
  assert.equal(snapshot.models[1].multiAgentVersion,'v2');
  assert.equal(snapshot.providerCapabilities.supportsWebSearch,true);
  const serialized=JSON.stringify(snapshot);
  assert.doesNotMatch(serialized,/must-not-leak/);
  assert.deepEqual(new Set(client.calls.map(x=>x.method)),new Set(['account/read','config/read','model/list','modelProvider/capabilities/read']));
  assert.equal(client.calls.some(x=>/login|write/i.test(x.method)),false);
});

test('Codex capability discovery understands current reasoning-level field names and model routing metadata', async () => {
  const client=new FakeClient((method)=>{
    if(method==='account/read')return {account:{type:'chatgpt'},requiresOpenaiAuth:true};
    if(method==='config/read')return {config:{model:'gpt-5.6-sol'}};
    if(method==='model/list')return {models:[{slug:'gpt-5.6-sol',display_name:'GPT-5.6-Sol',default_reasoning_level:'low',supported_reasoning_levels:[{effort:'low'},{effort:'medium'},{effort:'high'},{effort:'ultra'}],priority:1,visibility:'list',supported_in_api:true}]};
    if(method==='modelProvider/capabilities/read')return {};
    throw unsupported();
  });
  const provider=new CodexCapabilityProvider({client});
  await provider.initialize({backgroundRefresh:false});
  const snapshot=(await provider.refresh({reason:'test',manual:true})).capability;
  assert.equal(snapshot.models[0].defaultReasoningEffort,'low');
  assert.deepEqual(snapshot.models[0].reasoningEfforts.map(item=>item.value),['low','medium','high','ultra']);
  assert.equal(snapshot.models[0].priority,1);
  assert.equal(snapshot.models[0].visibility,'list');
  assert.equal(snapshot.models[0].supportedInApi,true);
});

test('Codex capability discovery distinguishes OpenAI API key and custom provider without managing either', async () => {
  const apiClient=new FakeClient((method)=>{
    if(method==='account/read')return {account:{type:'apiKey'},requiresOpenaiAuth:true};
    if(method==='config/read')return {config:{model_provider:'openai',model:'api-model'}};
    if(method==='model/list')return {data:[{id:'api-model',supportedReasoningEfforts:['low','high']}]};
    if(method==='modelProvider/capabilities/read')return {};
    throw unsupported();
  });
  const api=await new CodexCapabilityProvider({client:apiClient}).initialize({backgroundRefresh:false});
  assert.equal(api.provider.authMode,'apiKey'); assert.equal(api.execution.ready,true);

  const customClient=new FakeClient((method)=>{
    if(method==='account/read')return {account:null,requiresOpenaiAuth:false};
    if(method==='config/read')return {config:{model_provider:'glm',model:'glm-x'}};
    if(method==='model/list')return {data:[{id:'glm-x',supportedReasoningEfforts:[]}]};
    if(method==='modelProvider/capabilities/read')return {supportsWebSearch:false};
    throw unsupported();
  });
  const custom=await new CodexCapabilityProvider({client:customClient}).initialize({backgroundRefresh:false});
  assert.equal(custom.provider.id,'glm'); assert.equal(custom.provider.authMode,null); assert.equal(custom.execution.ready,true);
});

test('failed model refresh preserves the current configured model and degrades only catalog intelligence', async () => {
  const client=new FakeClient((method)=>{
    if(method==='account/read')return {account:{type:'chatgpt',planType:'pro'},requiresOpenaiAuth:true};
    if(method==='config/read')return {config:{model:'known-by-config-only'}};
    if(method==='model/list')throw unsupported();
    if(method==='modelProvider/capabilities/read')throw unsupported();
    throw unsupported();
  });
  const provider=new CodexCapabilityProvider({client});
  const snapshot=await provider.initialize({backgroundRefresh:false});
  assert.equal(snapshot.discoveryLevel,'partial');
  assert.equal(snapshot.execution.ready,true);
  assert.equal(snapshot.defaults.model,'known-by-config-only');
  assert.deepEqual(snapshot.models,[]);
  const refreshed=await provider.refresh({reason:'test-failure',manual:true});
  assert.equal(refreshed.refreshed,false);
  assert.equal(refreshed.capability.defaults.model,'known-by-config-only');
  assert.deepEqual(refreshed.capability.models,[]);
  assert.equal(refreshed.capability.lastRefresh.ok,false);
  assert.equal(refreshed.capability.lastRefresh.source,'manual');
  assert.equal(provider.refreshState().state,'manual_failed');
});

test('failed manual refresh atomically preserves the last successful model catalog instead of partially replacing it', async () => {
  let configured='model-a';
  let failModels=false;
  const client=new FakeClient((method)=>{
    if(method==='account/read')return {account:{type:'chatgpt'},requiresOpenaiAuth:true};
    if(method==='config/read')return {config:{model:configured}};
    if(method==='model/list'){if(failModels)throw new Error('model/list timeout');return {data:[{id:'model-a',supportedReasoningEfforts:['low','medium']}]};}
    if(method==='modelProvider/capabilities/read')return {};
    throw unsupported();
  });
  const provider=new CodexCapabilityProvider({client});
  await provider.initialize({backgroundRefresh:false});
  const success=await provider.refresh({reason:'first-success',manual:true});
  assert.equal(success.refreshed,true);
  assert.equal(success.capability.defaults.model,'model-a');
  assert.equal(success.capability.catalogState,'fresh');

  configured='model-b';
  failModels=true;
  const failed=await provider.refresh({reason:'manual-failure',manual:true});
  assert.equal(failed.refreshed,false);
  assert.equal(failed.capability.defaults.model,'model-a','failed refresh must not partially adopt a new config model');
  assert.deepEqual(failed.capability.models.map(model=>model.id),['model-a']);
  assert.equal(failed.capability.catalogState,'stale');
  assert.equal(failed.capability.lastRefresh.ok,false);
  assert.equal(failed.capability.lastRefresh.source,'manual');
  assert.equal(provider.refreshState().state,'manual_failed');
});

test('repeated lightweight initialize calls do not repeatedly trigger model/list after the single startup background refresh', async () => {
  let modelLists=0;
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const client=new FakeClient(async(method)=>{
    if(method==='account/read')return {account:{type:'chatgpt'},requiresOpenaiAuth:true};
    if(method==='config/read')return {config:{model:'model-a'}};
    if(method==='modelProvider/capabilities/read')return {};
    if(method==='model/list'){modelLists+=1;await pending;throw new Error('model/list timeout');}
    throw unsupported();
  });
  const provider=new CodexCapabilityProvider({client});
  await provider.initialize({backgroundRefresh:true});
  await provider.initialize({backgroundRefresh:true});
  await provider.initialize({backgroundRefresh:true});
  assert.equal(modelLists,1);
  release();
  while(provider.refreshInFlight) await new Promise(resolve=>setTimeout(resolve,1));
  await provider.initialize({backgroundRefresh:true});
  assert.equal(modelLists,1,'failed startup refresh is not retriggered by every Root/Subagent prepare; manual refresh owns the next attempt');
});



test('startup background refresh failure is distinct from manual failure and preserves the config model', async () => {
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const client=new FakeClient(async(method)=>{
    if(method==='account/read')return {account:{type:'chatgpt'},requiresOpenaiAuth:true};
    if(method==='config/read')return {config:{model:'model-config'}};
    if(method==='modelProvider/capabilities/read')return {};
    if(method==='model/list'){await pending;throw new Error('startup model/list timeout');}
    throw unsupported();
  });
  const provider=new CodexCapabilityProvider({client});
  const base=await provider.initialize({backgroundRefresh:true});
  assert.equal(base.defaults.model,'model-config');
  assert.equal(provider.refreshState().state,'refreshing');
  assert.equal(provider.refreshState().source,'startup');
  release();
  while(provider.refreshInFlight) await new Promise(resolve=>setTimeout(resolve,1));
  const state=provider.refreshState();
  assert.equal(state.state,'startup_failed');
  assert.equal(state.source,'startup');
  assert.equal(state.lastRefresh.ok,false);
  assert.equal(provider.snapshot().defaults.model,'model-config');
});

test('manual request joining an in-flight startup refresh owns the visible failure result', async () => {
  let release;
  const pending=new Promise(resolve=>{release=resolve;});
  const client=new FakeClient(async(method)=>{
    if(method==='account/read')return {account:{type:'chatgpt'},requiresOpenaiAuth:true};
    if(method==='config/read')return {config:{model:'model-config'}};
    if(method==='modelProvider/capabilities/read')return {};
    if(method==='model/list'){await pending;throw new Error('shared refresh timeout');}
    throw unsupported();
  });
  const provider=new CodexCapabilityProvider({client});
  await provider.initialize({backgroundRefresh:true});
  const manual=provider.refresh({reason:'manual-ui',manual:true});
  assert.equal(provider.refreshState().state,'refreshing');
  assert.equal(provider.refreshState().source,'manual');
  release();
  const result=await manual;
  assert.equal(result.refreshed,false);
  assert.equal(provider.refreshState().state,'manual_failed');
  assert.equal(provider.refreshState().lastRefresh.source,'manual');
  assert.equal(provider.snapshot().defaults.model,'model-config');
});



test('full refresh cannot report success when neither current nor retained config establishes model routing identity', async () => {
  const client=new FakeClient((method)=>{
    if(method==='account/read')return {account:{type:'chatgpt'},requiresOpenaiAuth:true};
    if(method==='config/read')throw new Error('config/read timeout');
    if(method==='model/list')return {data:[{id:'model-a',supportedReasoningEfforts:['low','medium']}]};
    if(method==='modelProvider/capabilities/read')return {};
    throw unsupported();
  });
  const provider=new CodexCapabilityProvider({client});
  const base=await provider.initialize({backgroundRefresh:false});
  assert.equal(base.routingSafe,false);
  assert.equal(base.defaults.model,null);
  const result=await provider.refresh({reason:'manual-ui',manual:true});
  assert.equal(result.refreshed,false);
  assert.equal(provider.refreshState().state,'manual_failed');
  assert.equal(provider.snapshot().defaults.model,null);
  assert.equal(provider.snapshot().catalogState,'unavailable');
});

test('app-server invalidation clears the visible refresh verdict for the old generation without deleting retained model evidence', async () => {
  const client=new FakeClient(fullHandler);
  const provider=new CodexCapabilityProvider({client});
  await provider.initialize({backgroundRefresh:false});
  await provider.refresh({reason:'success',manual:true});
  assert.equal(provider.refreshState().state,'success');
  assert.equal(provider.snapshot().defaults.model,'model-b');
  provider.invalidate('app-server-generation-changed');
  assert.equal(provider.refreshState().state,'idle');
  assert.equal(provider.snapshot().defaults.model,'model-b');
  assert.equal(provider.snapshot().stale,true);
});

test('capability snapshots are invalidated by app-server generation and context mismatches disable routing overrides', async () => {
  let baseReads=0;
  const client=new FakeClient((method,params)=>{
    if(method==='account/read')return {account:{type:'chatgpt'},requiresOpenaiAuth:true};
    if(method==='config/read'){
      baseReads+=1;
      if(params?.cwd)return {config:{model_provider:'thirdparty',model:'custom-z'}};
      return {config:{model_provider:'openai',model:'model-b'}};
    }
    if(method==='model/list')return {data:[{id:'model-b',supportedReasoningEfforts:['low','medium','high']}]};
    if(method==='modelProvider/capabilities/read')return {id:'openai'};
    throw unsupported();
  });
  const provider=new CodexCapabilityProvider({client});
  const first=await provider.initialize({backgroundRefresh:false});
  const cached=await provider.initialize({backgroundRefresh:false});
  assert.equal(first,cached);
  const scoped=await provider.discover({context:{cwd:'/project'}});
  assert.equal(scoped.defaults.model,'custom-z');
  assert.equal(scoped.provider.id,'thirdparty');
  assert.equal(scoped.routingSafe,false);
  const scopedCached=await provider.discover({context:{cwd:'/project'}});
  assert.equal(scoped,scopedCached);
  client.connectionGeneration=2;
  const afterRestart=await provider.initialize({backgroundRefresh:false});
  assert.notEqual(afterRestart,first);
  assert.equal(afterRestart.generation,2);
  assert.ok(baseReads>=3); // base + scoped + new generation base
});
