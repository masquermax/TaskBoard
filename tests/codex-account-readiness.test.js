import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexCapabilityProvider } from '../src/extensions/capabilities/codex/codex-capability-provider.js';
import { CodexConnectionSettings } from '../src/extensions/config/codex/codex-connection-settings.js';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';
import { Scheduler } from '../src/core/scheduler.js';

const REVOKED='Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.';

class CapabilityClient {
  static probe(){return{available:true,version:'codex-fake 1.0',error:null};}
  constructor({custom=false,handler}){this.custom=custom;this.handler=handler;this.calls=[];this.initialized=true;this.connectionGeneration=1;this.command='codex-fake';}
  isCustom(){return this.custom;}
  async connect(){this.initialized=true;}
  async request(method,params){this.calls.push({method,params});return this.handler(method,params);}
}

function openAiConfig(method){
  if(method==='config/read')return{config:{model_provider:'openai',model:'gpt-test'}};
  if(method==='modelProvider/capabilities/read')return{};
  throw new Error(`unexpected:${method}`);
}

test('account capability discovery force-refreshes Codex auth and exposes a revoked login as not ready before any Turn',async()=>{
  const client=new CapabilityClient({handler(method){
    if(method==='account/read')throw new Error(REVOKED);
    if(method==='model/list')throw new Error('model/list must not run when account auth is invalid');
    return openAiConfig(method);
  }});
  const capabilityProvider=new CodexCapabilityProvider({client});
  const capability=await capabilityProvider.initialize({backgroundRefresh:true});
  const authRead=client.calls.find(call=>call.method==='account/read');
  assert.deepEqual(authRead?.params,{refreshToken:true},'account startup discovery must validate the real refresh token, not only read cached account metadata');
  assert.equal(client.calls.some(call=>call.method==='model/list'),false,'invalid account auth must stop background model catalog refresh before it creates a second failure path');
  assert.equal(capability.execution.connected,true);
  assert.equal(capability.execution.ready,false);
  assert.equal(capability.provider.requiresOpenaiAuth,true);
  assert.match(capability.execution.error,/refresh token was revoked/i);

  const executor=new CodexExecutor({runtimeRoot:'unused',client,capabilityProvider});
  const readiness=executor.readiness();
  assert.equal(readiness.ready,false);
  assert.equal(readiness.preparing,false);
  assert.equal(readiness.reason,'executor-auth-required');
  assert.match(readiness.message,/重新登录/);

  let runnableScans=0;
  const scheduler=new Scheduler({
    repository:{listRunnableTasks(){runnableScans+=1;return[];}},
    taskService:{},
    rootRuntime:{executor},
  });
  await scheduler.tick();
  assert.equal(runnableScans,0,'known-invalid account auth must block admission before Scheduler even scans runnable Tasks');
});

test('custom transport capability discovery stays independent from Codex account refresh',async()=>{
  const client=new CapabilityClient({custom:true,handler(method,params){
    if(method==='account/read')return{account:null,requiresOpenaiAuth:false};
    if(method==='config/read')return{config:{model_provider:'taskboard_company',model:'company-model'}};
    if(method==='modelProvider/capabilities/read')return{};
    throw new Error(`unexpected:${method}`);
  }});
  const capability=await new CodexCapabilityProvider({client}).initialize({backgroundRefresh:false});
  const authRead=client.calls.find(call=>call.method==='account/read');
  assert.deepEqual(authRead?.params,{refreshToken:false},'custom provider discovery must not depend on or refresh the Codex account token');
  assert.equal(capability.execution.ready,true);
  assert.equal(capability.provider.requiresOpenaiAuth,false);
  assert.equal(capability.provider.id,'taskboard_company');
});

test('Executor readiness starts capability validation before admitting work when no connection snapshot exists yet',async()=>{
  let current=null;
  let initializeCalls=0;
  const capabilityProvider={
    snapshot(){return current;},
    async initialize(){initializeCalls+=1;current={execution:{connected:true,ready:true},provider:{requiresOpenaiAuth:true}};return current;},
  };
  const client={runtimeStatus(){return{available:true,preparing:false};}};
  const executor=new CodexExecutor({runtimeRoot:'unused',client,capabilityProvider});
  const first=executor.readiness();
  assert.equal(first.ready,false);
  assert.equal(first.preparing,true);
  assert.equal(first.reason,'executor-connection-preparing');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(initializeCalls,1);
  assert.equal(executor.readiness().ready,true);
});

test('re-applying the already-selected Codex account revalidates auth and replaces stale capability readiness',async()=>{
  const requests=[];
  const client={
    activeTurnCount:0,
    async connect(){},
    async request(method,params){
      requests.push({method,params});
      if(method==='account/read')return{account:{type:'chatgpt',planType:'plus'},requiresOpenaiAuth:true};
      if(method==='config/read')return{config:{model_provider:'openai'}};
      throw new Error(`unexpected:${method}`);
    },
  };
  const invalidations=[];
  let initializeCalls=0;
  const capabilityProvider={
    invalidate(reason){invalidations.push(reason);},
    async initialize(){initializeCalls+=1;return{execution:{connected:true,ready:true},provider:{requiresOpenaiAuth:true,authMode:'chatgpt'}};},
  };
  const settings=new CodexConnectionSettings();
  settings.bindRuntime({client,capabilityProvider});
  const result=await settings.update({action:'selectProfile',profileId:'account'});
  assert.equal(result.activeProfileId,'account');
  assert.deepEqual(requests[0],{method:'account/read',params:{refreshToken:true}});
  assert.deepEqual(requests[1],{method:'config/read',params:{}});
  assert.deepEqual(invalidations,['provider-profile-revalidated']);
  assert.equal(initializeCalls,1,'successful revalidation must refresh the cached capability snapshot instead of leaving an old auth failure visible');
});

test('re-applying Codex account fails immediately on revoked auth and does not refresh capability as if it were valid',async()=>{
  const client={
    activeTurnCount:0,
    async connect(){},
    async request(method){if(method==='account/read')throw new Error(REVOKED);throw new Error(`unexpected:${method}`);},
  };
  let invalidations=0;
  let initializeCalls=0;
  const settings=new CodexConnectionSettings();
  settings.bindRuntime({
    client,
    capabilityProvider:{invalidate(){invalidations+=1;},async initialize(){initializeCalls+=1;return null;}},
  });
  await assert.rejects(settings.update({action:'selectProfile',profileId:'account'}),/EXECUTOR_CONNECTION_AUTH_REQUIRED/);
  assert.equal(invalidations,0);
  assert.equal(initializeCalls,0);
});
