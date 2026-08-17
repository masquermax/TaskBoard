import test from 'node:test';
import assert from 'node:assert/strict';
import { basicCapabilitySnapshot } from '../src/extensions/ports/capability-provider.js';
import { CodexCapabilityProvider } from '../src/extensions/capabilities/codex/codex-capability-provider.js';

class FakeClient {
  static probe(){return{available:true,version:'codex-test',error:null};}
  constructor(){this.initialized=true;this.connectionGeneration=1;this.command='codex-test';}
  async connect(){this.initialized=true;}
  async request(method){
    if(method==='account/read')return{account:{type:'chatgpt'},requiresOpenaiAuth:true};
    if(method==='config/read')return{config:{model:'model-a'}};
    if(method==='modelProvider/capabilities/read')return{};
    throw Object.assign(new Error('Method not found'),{rpcCode:-32601});
  }
}

test('generic Capability snapshots do not imply explicit model selection',()=>{
  const snapshot=basicCapabilitySnapshot({extensionId:'generic',displayName:'Generic'});
  assert.deepEqual(snapshot.modelSelection,{explicitPerTurn:false,maxPerTurn:1});
});

test('Codex Capability explicitly advertises one selectable model per Turn',async()=>{
  const provider=new CodexCapabilityProvider({client:new FakeClient()});
  const snapshot=await provider.initialize({backgroundRefresh:false});
  assert.deepEqual(snapshot.modelSelection,{explicitPerTurn:true,maxPerTurn:1});
  assert.equal(snapshot.defaults.model,'model-a');
});
