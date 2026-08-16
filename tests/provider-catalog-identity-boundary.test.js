import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexCapabilityProvider } from '../src/extensions/capabilities/codex/codex-capability-provider.js';
import { ModelRouter } from '../src/core/model-router.js';

class SwitchingProviderClient {
  static probe(){ return { available:true, version:'codex-fake 9.9', error:null }; }
  constructor(){
    this.initialized=true;
    this.connectionGeneration=1;
    this.command='codex-fake';
    this.providerId='provider-a';
    this.defaultModel='old-frontier';
  }
  async connect(){ this.initialized=true; }
  async request(method){
    if(method==='account/read')return {account:null,requiresOpenaiAuth:false};
    if(method==='config/read')return {config:{model_provider:this.providerId,model:this.defaultModel}};
    if(method==='modelProvider/capabilities/read')return {};
    if(method==='model/list')return {data:[{
      id:'old-frontier',
      displayName:'Old Frontier',
      description:'frontier strongest capability for complex reasoning',
      supportedReasoningEfforts:['medium','high'],
    }]};
    const error=new Error(`unsupported ${method}`);
    error.rpcCode=-32601;
    throw error;
  }
}

test('provider switch cannot make an old-provider model catalog routable under the new provider identity', async()=>{
  const client=new SwitchingProviderClient();
  const provider=new CodexCapabilityProvider({client});

  await provider.initialize({backgroundRefresh:false});
  const firstRefresh=await provider.refresh({reason:'provider-a-catalog',manual:true});
  assert.equal(firstRefresh.refreshed,true);
  assert.equal(firstRefresh.capability.provider.id,'provider-a');
  assert.deepEqual(firstRefresh.capability.models.map(model=>model.id),['old-frontier']);
  assert.equal(firstRefresh.capability.catalogState,'fresh');

  client.providerId='provider-b';
  client.defaultModel='new-provider-default';
  client.connectionGeneration=2;
  provider.invalidate('provider-profile-changed');

  const afterSwitch=await provider.initialize({backgroundRefresh:false});
  assert.equal(afterSwitch.provider.id,'provider-b');
  assert.equal(afterSwitch.defaults.model,'new-provider-default');

  const task={id:'T-PROVIDER-SWITCH',title:'Architecture migration',instruction:'Perform a complex architecture migration analysis.'};
  const router=new ModelRouter({capabilityProvider:provider});
  await router.prepare({task});
  const policy=router.route({role:'root',task});

  assert.equal(afterSwitch.models.some(model=>model.id==='old-frontier'),false,'a catalog whose provider provenance no longer matches must not survive into the new provider snapshot');
  assert.equal(policy.model,'new-provider-default','routing must fall back to the new provider configured model until a fresh matching catalog is discovered');
  assert.notEqual(policy.model,'old-frontier');
});
