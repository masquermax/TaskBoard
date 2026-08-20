import test from 'node:test';
import assert from 'node:assert/strict';
import { ModelRouter } from '../src/core/model-router.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';

function capabilityProvider(){return{snapshot(){return{discoveryLevel:'full',routingSafe:true,defaults:{model:'balanced-model'},modelSelection:{explicitPerTurn:true,maxPerTurn:1},models:[{id:'fast-model',description:'Fast efficient model for routine lightweight work',reasoningEfforts:[{value:'low'},{value:'medium'}],priority:1},{id:'balanced-model',description:'Balanced general-purpose model for everyday work',reasoningEfforts:[{value:'low'},{value:'medium'},{value:'high'}],priority:1}]};}};}
function readWork(){return{id:'WU-READ',title:'读取 package.json 版本',goal:'只读取 package.json version。',expectedOutput:'返回 version 与定位。',stopCondition:'读取后立即停止。',projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']};}
function broadWork(){return{id:'WU-AUDIT',title:'版本身份与全链路审计',goal:'跨实现、配置、运行时与验证链核对当前行为。',expectedOutput:'返回关键链路和源码证据。',stopCondition:'关键链路有来源后停止。',projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']};}

test('broad repository Work is not downgraded to the efficient model merely because it has a stopCondition',()=>{
  const router=new ModelRouter({capabilityProvider:capabilityProvider()}),task={id:'T',title:'审计',instruction:'核对',projectScopes:[{path:process.cwd()}]};
  const route=router.route({role:'subagent',task,work:broadWork()});assert.equal(route.model,'balanced-model');assert.equal(route.reasoningEffort,'medium');
});

test('genuinely bounded read-only Work qualifies for efficient routing',()=>{
  const router=new ModelRouter({capabilityProvider:capabilityProvider()}),task={id:'T',title:'读取版本',instruction:'读取',projectScopes:[{path:process.cwd()}]};
  const route=router.route({role:'subagent',task,work:readWork()});assert.equal(route.model,'fast-model');assert.equal(route.reasoningEffort,'low');
});

test('a blocked prerequisite ends the dependent Work before any model/tool call',async()=>{
  let executorCalls=0,prepareCalls=0;
  const runtime=new SubagentRuntime({executor:{async runSubagent(){executorCalls+=1;}},modelRouter:{async prepare(){prepareCalls+=1;},route(){return{};}}});
  const result=await runtime.run({id:'T',projectScopes:[],attachments:[],references:[]},{...readWork(),id:'WU-DEPENDENT',projectAccess:'none',inputRefs:[],dependsOn:['WU-AUDIT'],dependencyResults:[{id:'WU-AUDIT',result:{blocker:'upstream blocker'}}]});
  assert.equal(executorCalls,0);assert.equal(prepareCalls,0);assert.match(result.blocker,/WORK_UNIT_DEPENDENCY_UNSATISFIED/);
});

test('SubagentRuntime does not invent a technical non-convergence state around Executor failures',async()=>{
  const error=new Error('executor failed');error.nonRetryable=true;
  const runtime=new SubagentRuntime({executor:{async runSubagent(){throw error;}},modelRouter:{async prepare(){},route(){return{};}}});
  await assert.rejects(runtime.run({id:'T',projectScopes:[],attachments:[],references:[]},{...readWork(),projectAccess:'none',inputRefs:[]}),/executor failed/);
});
