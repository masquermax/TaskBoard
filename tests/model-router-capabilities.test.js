import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../src/core/model-router.js';

class Provider {
  constructor(snapshot){this.value={modelSelection:{explicitPerTurn:true,maxPerTurn:1},...snapshot};this.calls=[];}
  async discover(options){this.calls.push(options);return this.value;}
  snapshot(){return this.value;}
}
function task(extra={}){return{id:'T-1',title:'复杂架构综合分析',instruction:'完整检查架构、安全、性能与并发并给出方案',projectScopes:[],attachments:[],references:[],...extra};}

test('router selects reasoning only from the discovered ordered range of the configured default model', async () => {
  const provider=new Provider({discoveryLevel:'full',routingSafe:true,defaults:{model:'m1'},models:[{id:'m1',reasoningEfforts:[{value:'tiny'},{value:'balanced'},{value:'deep'},{value:'ultra'}]}]});
  const router=new ModelRouter({capabilityProvider:provider}); const t=task();
  await router.prepare({task:t}); const route=router.route({role:'root',task:t});
  assert.equal(route.reasoningEffort,'deep');
  assert.equal(route.model,'m1'); // pass config/read's known default explicitly
  assert.equal(route.configuredDefaultModel,'m1');
  assert.equal(route.routeReason,'minimum-sufficient-high');
});

test('router uses executor default only when config is unsafe; a config/read model is passed explicitly even without catalog metadata', async () => {
  const unsafe=new Provider({discoveryLevel:'basic',routingSafe:false,defaults:{model:'m1'},models:[{id:'m1',reasoningEfforts:[{value:'high'}]}]});
  let router=new ModelRouter({capabilityProvider:unsafe}); let t=task();
  await router.prepare({task:t}); let route=router.route({role:'root',task:t});
  assert.equal(route.model,null); assert.equal(route.reasoningEffort,null); assert.equal(route.routeReason,'executor-default');

  const configuredOnly=new Provider({discoveryLevel:'partial',routingSafe:true,defaults:{model:'unknown'},models:[{id:'m1',reasoningEfforts:[{value:'high'}]}]});
  router=new ModelRouter({capabilityProvider:configuredOnly}); t=task();
  await router.prepare({task:t}); route=router.route({role:'root',task:t});
  assert.equal(route.model,'unknown'); assert.equal(route.reasoningEffort,null); assert.equal(route.routeReason,'configured-model');
});

test('model catalog cardinality does not imply an Executor supports explicit per-Turn model selection', async()=>{
  const provider=new Provider({
    discoveryLevel:'full',routingSafe:true,
    modelSelection:{explicitPerTurn:false,maxPerTurn:1},
    defaults:{model:'configured-default'},
    models:[
      {id:'configured-default',description:'Balanced general-purpose model.',reasoningEfforts:[{value:'medium'}]},
      {id:'alternate',description:'Flagship model for complex reasoning.',reasoningEfforts:[{value:'high'}]},
    ],
  });
  const router=new ModelRouter({capabilityProvider:provider}); const t=task({id:'NO-MODEL-OVERRIDE'});
  await router.prepare({task:t}); const route=router.route({role:'root',task:t});
  assert.equal(route.model,null,'TaskBoard must leave model selection to the Executor when the slot is not supported');
  assert.equal(route.reasoningEffort,null);
  assert.equal(route.configuredDefaultModel,'configured-default');
  assert.equal(route.routeReason,'executor-default');
});

test('router passes Task cwd to capability discovery without exposing a user model selector', async () => {
  const provider=new Provider({discoveryLevel:'partial',routingSafe:false,defaults:{model:null},models:[]});
  const router=new ModelRouter({capabilityProvider:provider}); const t=task({projectScopes:[{path:'/project/a'}]});
  await router.prepare({task:t});
  assert.deepEqual(provider.calls[0],{context:{cwd:'/project/a'}});
});


test('source-backed OA requirement analysis uses a lighter known reasoning tier for minimum-sufficient retrieval', async () => {
  const provider=new Provider({discoveryLevel:'full',routingSafe:true,defaults:{model:'m1'},models:[{id:'m1',reasoningEfforts:[{value:'tiny'},{value:'balanced'},{value:'deep'},{value:'ultra'}]}]});
  const router=new ModelRouter({capabilityProvider:provider});
  const t=task({title:'OA备件入库需求分析',instruction:'根据附件与项目告知我具体步骤',attachments:[{id:'A-1'}],projectScopes:[{path:'/oa'}],references:[]});
  await router.prepare({task:t});
  const route=router.route({role:'root',task:t});
  assert.equal(route.reasoningEffort,'balanced');
  assert.equal(route.routeReason,'minimum-sufficient-retrieval');
});

test('current six-level Codex reasoning catalog never auto-escalates TaskBoard into xhigh/max/ultra delegation modes', async () => {
  const provider=new Provider({discoveryLevel:'full',routingSafe:true,defaults:{model:'gpt-5.6-sol'},models:[{id:'gpt-5.6-sol',reasoningEfforts:['low','medium','high','xhigh','max','ultra'].map(value=>({value}))}]});
  const router=new ModelRouter({capabilityProvider:provider});
  const oa=task({id:'OA',title:'OA备件入库需求分析',instruction:'根据附件与项目告知我具体步骤',attachments:[{id:'A-1'}],projectScopes:[{path:'/oa'}],references:[]});
  await router.prepare({task:oa});
  assert.equal(router.route({role:'root',task:oa}).reasoningEffort,'medium');

  const hard=task({id:'HARD',title:'复杂架构综合分析',instruction:'完整检查架构、安全、性能、并发、迁移并给出端到端重构方案'});
  await router.prepare({task:hard});
  const route=router.route({role:'root',task:hard});
  assert.equal(route.reasoningEffort,'high');
  assert.equal(route.configuredDefaultModel,'gpt-5.6-sol');
  assert.ok(!['xhigh','max','ultra'].includes(route.reasoningEffort));
});

test('router chooses the minimum sufficient model from capability metadata, never from model ids', async()=>{
  const provider=new Provider({
    discoveryLevel:'full',routingSafe:true,defaults:{model:'opaque-frontier'},models:[
      {id:'opaque-frontier',description:'Flagship model with the strongest capability for complex coding and long-running research.',priority:30,reasoningEfforts:['low','medium','high'].map(value=>({value}))},
      {id:'opaque-balanced',description:'Balanced general-purpose choice for everyday engineering and reliable daily work.',priority:20,reasoningEfforts:['low','medium','high'].map(value=>({value}))},
      {id:'opaque-efficient',description:'Fast, efficient, low-latency model for routine high-throughput tasks.',priority:10,reasoningEfforts:['low','medium','high'].map(value=>({value}))},
    ],
  });
  const router=new ModelRouter({capabilityProvider:provider});
  const oa=task({id:'OA-MODEL',title:'OA备件入库需求分析',instruction:'根据附件与项目告知我具体步骤',attachments:[{id:'A-1'}],projectScopes:[{path:'/oa'}],references:[]});
  await router.prepare({task:oa});

  const root=router.route({role:'root',task:oa});
  assert.equal(root.model,'opaque-balanced');
  assert.equal(root.configuredDefaultModel,'opaque-frontier');
  assert.equal(root.reasoningEffort,'medium');
  assert.equal(root.routeReason,'minimum-sufficient-model-balanced');

  const work={id:'WU-1',title:'提取附件需求',goal:'只读提取附件中的明确业务规则',expectedOutput:'带来源的事实列表',stopCondition:'明确字段、流程和缺口均已列出即停止',projectAccess:'read'};
  const subagent=router.route({role:'subagent',task:oa,work});
  assert.equal(subagent.model,'opaque-efficient');
  assert.equal(subagent.reasoningEffort,'low');
  assert.equal(subagent.routeReason,'minimum-sufficient-model-efficient');

  const validator=router.route({role:'validator',task:oa});
  assert.equal(validator.model,'opaque-balanced');
  assert.equal(validator.reasoningEffort,'medium');

  const hard=task({id:'HARD-MODEL',title:'执行器并发架构重构',instruction:'定位根因并设计端到端并发、安全与迁移方案'});
  await router.prepare({task:hard});
  const frontier=router.route({role:'root',task:hard});
  assert.equal(frontier.model,'opaque-frontier');
  assert.equal(frontier.reasoningEffort,'high');
  assert.equal(frontier.routeReason,'minimum-sufficient-model-frontier');
});

test('router falls back to the configured model when catalog metadata cannot prove another model is sufficient', async()=>{
  const provider=new Provider({
    discoveryLevel:'full',routingSafe:true,defaults:{model:'configured-x'},models:[
      {id:'configured-x',description:'',reasoningEfforts:[{value:'low'},{value:'medium'},{value:'high'}]},
      {id:'mystery-y',description:'Special model.',reasoningEfforts:[{value:'low'},{value:'medium'}]},
    ],
  });
  const router=new ModelRouter({capabilityProvider:provider});
  const t=task({id:'UNKNOWN-META',title:'普通任务',instruction:'检查现有信息'});
  await router.prepare({task:t});
  const route=router.route({role:'root',task:t});
  assert.equal(route.model,'configured-x');
  assert.equal(route.configuredDefaultModel,'configured-x');
  assert.equal(route.reasoningEffort,'medium');
  assert.equal(route.routeReason,'minimum-sufficient-medium');
});
