import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelSelectionStore } from '../src/core/model-selection.js';
import { ModelRouter } from '../src/core/model-router.js';

function models(){return[
  {id:'frontier',displayName:'Frontier',description:'Flagship frontier model for hardest complex reasoning.',priority:30,reasoningEfforts:['low','medium','high'].map(value=>({value}))},
  {id:'balanced',displayName:'Balanced',description:'Balanced general-purpose model for everyday engineering.',priority:20,reasoningEfforts:['low','medium','high'].map(value=>({value}))},
  {id:'efficient',displayName:'Efficient',description:'Fast efficient low-latency model for routine tasks.',priority:10,reasoningEfforts:['low','medium'].map(value=>({value}))},
];}
function capability(extra={}){return{discoveryLevel:'full',routingSafe:true,catalogState:'fresh',execution:{ready:true},defaults:{model:'frontier'},modelSelection:{explicitPerTurn:true,maxPerTurn:1},models:models(),...extra};}
function task(extra={}){return{id:'T',title:'普通任务',instruction:'检查现有信息',projectScopes:[],attachments:[],references:[],...extra};}

class Provider{
  constructor(snapshot){this.value=snapshot;}
  async discover(){return this.value;}
  snapshot(){return this.value;}
}

test('model selection defaults to automatic and accepts an explicit visible model',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-model-selection-'));
  try{
    const store=new ModelSelectionStore({file:join(dir,'selection.json')});
    assert.deepEqual(store.get(),{mode:'auto',model:null});
    const next=store.update({mode:'specific',model:'balanced'},{capability:capability()});
    assert.deepEqual(next.selection,{mode:'specific',model:'balanced'});
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('temporary catalog/network loss never invalidates a user-selected model',()=>{
  const store=new ModelSelectionStore();
  store.update({mode:'specific',model:'balanced'},{capability:capability()});
  const stale=capability({catalogState:'stale',execution:{ready:false},models:[]});
  const result=store.reconcile(stale);
  assert.equal(result.changed,false);
  assert.deepEqual(store.get(),{mode:'specific',model:'balanced'});
  assert.equal(store.publicState(stale).notice,null);
});

test('a fresh successful catalog that proves the selected model disappeared returns to automatic with a notice',()=>{
  const store=new ModelSelectionStore();
  store.update({mode:'specific',model:'balanced'},{capability:capability()});
  const freshWithoutBalanced=capability({models:models().filter(model=>model.id!=='balanced')});
  const result=store.reconcile(freshWithoutBalanced);
  assert.equal(result.changed,true);
  assert.deepEqual(store.get(),{mode:'auto',model:null});
  assert.equal(store.publicState(freshWithoutBalanced).notice.model,'balanced');
});

test('specific mode overrides automatic tier choice while reasoning effort remains minimum sufficient',async()=>{
  const provider=new Provider(capability());
  const store=new ModelSelectionStore();
  store.update({mode:'specific',model:'efficient'},{capability:provider.snapshot()});
  const router=new ModelRouter({capabilityProvider:provider,modelSelection:store});
  const current=task({title:'复杂架构综合分析',instruction:'完整检查架构、安全、性能、并发、迁移并给出端到端重构方案'});
  await router.prepare({role:'root',task:current});
  const route=router.route({role:'root',task:current});
  assert.equal(route.selectionMode,'specific');
  assert.equal(route.model,'efficient');
  assert.equal(route.routeReason,'user-selected-model');
  assert.equal(route.reasoningEffort,null);
});

test('automatic mode preserves minimum-sufficient routing',async()=>{
  const provider=new Provider(capability());
  const store=new ModelSelectionStore();
  const router=new ModelRouter({capabilityProvider:provider,modelSelection:store});
  const current=task();
  await router.prepare({role:'root',task:current});
  const route=router.route({role:'root',task:current});
  assert.equal(route.selectionMode,'auto');
  assert.equal(route.model,'balanced');
  assert.equal(route.routeReason,'minimum-sufficient-model-balanced');
});
