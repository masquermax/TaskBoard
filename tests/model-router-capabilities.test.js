import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../src/core/model-router.js';

class Provider{constructor(snapshot){this.value={modelSelection:{explicitPerTurn:true,maxPerTurn:1},...snapshot};this.calls=[];}async discover(options){this.calls.push(options);return this.value;}snapshot(){return this.value;}}
function task(extra={}){return{id:'T',title:'普通任务',instruction:'检查现有信息',projectScopes:[],attachments:[],references:[],...extra};}
function models(){return[
  {id:'frontier',description:'Flagship frontier model for hardest complex reasoning.',priority:30,reasoningEfforts:['low','medium','high','xhigh'].map(value=>({value}))},
  {id:'balanced',description:'Balanced general-purpose model for everyday engineering.',priority:20,reasoningEfforts:['low','medium','high'].map(value=>({value}))},
  {id:'efficient',description:'Fast efficient low-latency model for routine tasks.',priority:10,reasoningEfforts:['low','medium'].map(value=>({value}))},
];}

test('Root retrieval and bounded Subagent use the minimum sufficient known route',async()=>{
  const provider=new Provider({discoveryLevel:'full',routingSafe:true,defaults:{model:'frontier'},models:models()}),router=new ModelRouter({capabilityProvider:provider}),current=task({title:'OA备件入库需求分析',instruction:'根据附件与项目告知我具体步骤',attachments:[{id:'A'}],projectScopes:[{path:'/oa'}]});
  await router.prepare({task:current});
  const root=router.route({role:'root',task:current});assert.equal(root.model,'balanced');assert.equal(root.reasoningEffort,'medium');
  const work={id:'W',title:'读取字段',goal:'只读一个明确字段',expectedOutput:'字段值和定位',stopCondition:'字段值已取得即停止',projectAccess:'read',inputRefs:['project:0']};
  const sub=router.route({role:'subagent',task:current,work});assert.equal(sub.model,'efficient');assert.equal(sub.reasoningEffort,'low');assert.equal(sub.routeReason,'minimum-sufficient-model-efficient');
});

test('broad or deep Work is not made lightweight merely by having a stopCondition',async()=>{
  const provider=new Provider({discoveryLevel:'full',routingSafe:true,defaults:{model:'frontier'},models:models()}),router=new ModelRouter({capabilityProvider:provider}),current=task({projectScopes:[{path:'/repo'}]});await router.prepare({task:current});
  const work={id:'W',title:'全链路审计',goal:'跨实现、配置、运行时和验证链审计',expectedOutput:'完整链路',stopCondition:'审计完成',projectAccess:'read',inputRefs:['project:0']};
  const route=router.route({role:'subagent',task:current,work});assert.equal(route.model,'balanced');assert.equal(route.reasoningEffort,'medium');
});

test('complex Root is capped at the normal high band instead of auto-escalating to exotic tiers',async()=>{
  const provider=new Provider({discoveryLevel:'full',routingSafe:true,defaults:{model:'frontier'},models:models()}),router=new ModelRouter({capabilityProvider:provider}),current=task({title:'复杂架构综合分析',instruction:'完整检查架构、安全、性能、并发、迁移并给出端到端重构方案'});await router.prepare({task:current});const route=router.route({role:'root',task:current});assert.equal(route.model,'frontier');assert.equal(route.reasoningEffort,'high');assert.ok(!['xhigh','max','ultra'].includes(route.reasoningEffort));
});

test('unsafe/non-selectable capability leaves model choice to Executor',async()=>{
  const provider=new Provider({discoveryLevel:'basic',routingSafe:false,modelSelection:{explicitPerTurn:false,maxPerTurn:1},defaults:{model:'configured'},models:models()}),router=new ModelRouter({capabilityProvider:provider}),current=task();await router.prepare({task:current});const route=router.route({role:'root',task:current});assert.equal(route.model,null);assert.equal(route.reasoningEffort,null);assert.equal(route.routeReason,'executor-default');
});

test('Task cwd is used only for capability discovery',async()=>{
  const provider=new Provider({discoveryLevel:'partial',routingSafe:false,defaults:{model:null},models:[]}),router=new ModelRouter({capabilityProvider:provider}),current=task({projectScopes:[{path:'/project/a'}]});await router.prepare({task:current});assert.deepEqual(provider.calls[0],{context:{cwd:'/project/a'}});
});

test('Validator has no model route because it is deterministic',()=>{
  const router=new ModelRouter();assert.throws(()=>router.route({role:'validator',task:task()}),/MODEL_ROUTE_ROLE_INVALID:validator/);
});
