import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexTransportClient } from '../src/extensions/executors/codex/transport-client.js';
import { CodexCapabilityProvider } from '../src/extensions/capabilities/codex/codex-capability-provider.js';

class FakeApp {
  constructor(){this.connects=0;this.runs=0;this.requests=[];this.listeners=[];this.initialized=false;this.version='codex-test';this.command='codex';this.activeTurnCount=0;this.runtimeResolver={};}
  onConnectionGeneration(fn){this.listeners.push(fn);return()=>{};}
  async connect(){this.connects+=1;this.initialized=true;for(const fn of this.listeners)fn(1);}
  async probeRuntime(){return{available:true,version:'codex-test'};}
  async request(method){this.requests.push(method);return{from:'app',method};}
  async runTurn(){this.runs+=1;return'app-result';}
  close(){this.initialized=false;}
  recordDiagnostic(){}
}
class FakeExec {
  constructor(){this.runs=0;this.activeTurnCount=0;this.child=null;}
  async runTurn(){this.runs+=1;return'exec-result';}
  close(){}
}

test('account mode stays on app-server while custom mode uses codex exec and never starts app-server',async()=>{
  const app=new FakeApp();
  const exec=new FakeExec();
  let profile={mode:'account',profileId:'account',providerId:null,args:[],env:{}};
  const client=new CodexTransportClient({appServerClient:app,execClient:exec,launchProfileProvider:()=>profile});
  assert.equal(await client.runTurn({}),'app-result');
  assert.equal(app.connects,0,'runTurn delegates to app-server which owns its own connection');
  assert.equal(app.runs,1);
  assert.equal(exec.runs,0);

  client.close();
  profile={
    mode:'custom',profileId:'company',providerId:'taskboard_company',
    args:['-c','model_provider="taskboard_company"','-c','model="gpt-5.6-sol"'],
    env:{TASKBOARD_CODEX_API_KEY:'secret'},
  };
  assert.equal(await client.runTurn({}),'exec-result');
  assert.equal(app.connects,0,'custom mode must not create the app-server path rejected by the upstream');
  assert.equal(exec.runs,1);
  const config=await client.request('config/read',{});
  assert.equal(config.config.model_provider,'taskboard_company');
  assert.equal(config.config.model,'gpt-5.6-sol');
  await assert.rejects(client.request('model/list',{}),error=>error?.rpcCode===-32601);
});

test('custom capability discovery and catalog refresh never fall back to app-server',async()=>{
  const app=new FakeApp();
  const exec=new FakeExec();
  const profile={
    mode:'custom',profileId:'company',providerId:'taskboard_company',
    args:['-c','model_provider="taskboard_company"','-c','model="gpt-5.6-sol"'],
    env:{TASKBOARD_CODEX_API_KEY:'secret'},
  };
  const client=new CodexTransportClient({appServerClient:app,execClient:exec,launchProfileProvider:()=>profile});
  const capabilityProvider=new CodexCapabilityProvider({client});

  const capability=await capabilityProvider.initialize({backgroundRefresh:false});
  assert.equal(capability.execution.ready,true);
  assert.equal(capability.provider.id,'taskboard_company');
  assert.equal(capability.defaults.model,'gpt-5.6-sol');
  assert.equal(capability.catalogState,'unavailable');
  assert.equal(app.connects,0);
  assert.deepEqual(app.requests,[],'custom discovery must use transport-owned synthetic facts only');

  const refresh=await capabilityProvider.refresh({reason:'test-custom-catalog',manual:false});
  assert.equal(refresh.refreshed,false);
  assert.match(refresh.error,/model\/list unsupported/i);
  assert.equal(app.connects,0);
  assert.deepEqual(app.requests,[],'unsupported custom catalog refresh must not touch app-server');
});
