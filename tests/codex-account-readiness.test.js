import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexConnectionSettings } from '../src/extensions/config/codex/codex-connection-settings.js';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';

const REVOKED='Your access token could not be refreshed because your refresh token was revoked. Please log out and sign in again.';

test('account capability discovery force-refreshes Codex auth and exposes a revoked login as not ready before any Turn',async()=>{
  const calls=[];
  const client={
    async request(method,params){calls.push({method,params});if(method==='account/read')throw new Error(REVOKED);throw new Error(`unexpected:${method}`);},
    runtimeStatus(){return{available:true,preparing:false};},
  };
  const provider={
    client,
    current:null,
    snapshot(){return this.current;},
    async initialize(){try{await client.request('account/read',{refreshToken:true});this.current={execution:{connected:true,ready:true},provider:{requiresOpenaiAuth:true}};}catch(error){this.current={execution:{connected:true,ready:false,error:error.message},provider:{requiresOpenaiAuth:true}};}return this.current;},
  };
  const executor=new CodexExecutor({runtimeRoot:'unused',client,capabilityProvider:provider});
  const first=executor.readiness();
  assert.equal(first.ready,false);
  assert.equal(first.preparing,true);
  await new Promise(resolve=>setImmediate(resolve));
  const readiness=executor.readiness();
  assert.equal(readiness.ready,false);
  assert.equal(readiness.reason,'executor-auth-required');
  assert.deepEqual(calls,[{method:'account/read',params:{refreshToken:true}}]);
});

test('custom transport capability discovery stays independent from Codex account refresh',async()=>{
  let initializeCalls=0;
  const client={runtimeStatus(){return{available:true,preparing:false};}};
  const capabilityProvider={
    snapshot(){return{execution:{connected:true,ready:true},provider:{requiresOpenaiAuth:false}};},
    async initialize(){initializeCalls+=1;return this.snapshot();},
  };
  const executor=new CodexExecutor({runtimeRoot:'unused',client,capabilityProvider});
  assert.equal(executor.readiness().ready,true);
  assert.equal(initializeCalls,0);
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
      if(method==='config/read')return{config:{model_provider:'openai'},layers:[]};
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
  assert.deepEqual(requests[1],{method:'config/read',params:{includeLayers:true}},'account validation must request config layers so a user/project override of the builtin provider cannot be hidden');
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
