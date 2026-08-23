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
function capability(providerId='provider-a',extra={}){return{schemaVersion:1,extensionId:'codex',provider:{id:providerId},discoveryLevel:'full',routingSafe:true,catalogState:'fresh',execution:{ready:true},defaults:{model:'frontier'},modelSelection:{explicitPerTurn:true,maxPerTurn:1},models:models(),...extra};}
function task(extra={}){return{id:'T',title:'普通任务',instruction:'检查现有信息',projectScopes:[],attachments:[],references:[],...extra};}
class Provider{constructor(snapshot){this.value=snapshot;}async discover(){return this.value;}snapshot(){return this.value;}}

test('explicit model preference is isolated by extension/provider capability provenance and persists',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-model-selection-'));
  try{
    const file=join(dir,'selection.json'),store=new ModelSelectionStore({file});
    const a=capability('provider-a'),b=capability('provider-b');
    assert.deepEqual(store.get(a),{mode:'auto',model:null});
    store.update({mode:'specific',model:'balanced'},{capability:a});
    assert.deepEqual(store.get(a),{mode:'specific',model:'balanced'});
    assert.deepEqual(store.get(b),{mode:'auto',model:null});
    store.update({mode:'specific',model:'efficient'},{capability:b});
    const reloaded=new ModelSelectionStore({file});
    assert.deepEqual(reloaded.get(a),{mode:'specific',model:'balanced'});
    assert.deepEqual(reloaded.get(b),{mode:'specific',model:'efficient'});
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('temporary catalog/network loss preserves the scoped explicit selection',()=>{
  const store=new ModelSelectionStore(),fresh=capability('provider-a');
  store.update({mode:'specific',model:'balanced'},{capability:fresh});
  const stale=capability('provider-a',{catalogState:'stale',execution:{ready:false},routingSafe:false,models:[]});
  const result=store.reconcile(stale);
  assert.equal(result.changed,false);
  assert.deepEqual(store.get(stale),{mode:'specific',model:'balanced'});
  assert.equal(store.publicState(stale).notice,null);
});

test('fresh catalog invalidates only the missing model in the same capability scope',()=>{
  const store=new ModelSelectionStore(),a=capability('provider-a'),b=capability('provider-b');
  store.update({mode:'specific',model:'balanced'},{capability:a});
  store.update({mode:'specific',model:'efficient'},{capability:b});
  const freshWithoutBalanced=capability('provider-a',{models:models().filter(model=>model.id!=='balanced')});
  const result=store.reconcile(freshWithoutBalanced);
  assert.equal(result.changed,true);
  assert.deepEqual(store.get(a),{mode:'auto',model:null});
  assert.deepEqual(store.get(b),{mode:'specific',model:'efficient'});
  assert.equal(store.publicState(freshWithoutBalanced).notice.model,'balanced');
  assert.deepEqual(store.publicState(freshWithoutBalanced).notice.scope,{extensionId:'codex',providerId:'provider-a'});
});

test('specific mode overrides automatic model tier but keeps minimum-sufficient reasoning within that model',async()=>{
  const provider=new Provider(capability('provider-a')),store=new ModelSelectionStore();
  store.update({mode:'specific',model:'balanced'},{capability:provider.snapshot()});
  const router=new ModelRouter({capabilityProvider:provider,modelSelection:store});
  const current=task({title:'复杂架构综合分析',instruction:'完整检查架构、安全、性能、并发、迁移并给出端到端重构方案'});
  await router.prepare({role:'root',task:current});
  const route=router.route({role:'root',task:current});
  assert.equal(route.selectionMode,'specific');
  assert.equal(route.model,'balanced');
  assert.equal(route.routeReason,'user-selected-model');
  assert.equal(route.reasoningEffort,'high');
});

test('automatic mode remains minimum-sufficient and a different provider cannot inherit an explicit model',async()=>{
  const a=capability('provider-a'),b=capability('provider-b'),store=new ModelSelectionStore();
  store.update({mode:'specific',model:'frontier'},{capability:a});
  const provider=new Provider(b),router=new ModelRouter({capabilityProvider:provider,modelSelection:store});
  const current=task();
  await router.prepare({role:'root',task:current});
  const route=router.route({role:'root',task:current});
  assert.equal(route.selectionMode,'auto');
  assert.equal(route.model,'balanced');
  assert.equal(route.routeReason,'minimum-sufficient-model-balanced');
});

test('specific selection fails closed when no stable capability scope is known',()=>{
  const store=new ModelSelectionStore();
  assert.throws(()=>store.update({mode:'specific',model:'balanced'},{capability:{...capability(),provider:null}}),/MODEL_SELECTION_SCOPE_UNAVAILABLE/);
});
