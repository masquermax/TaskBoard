import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';

const gap={id:'G-SOURCE',question:'当前 TaskBoard 中 Human Gateway 从用户回答到恢复执行的真实源码调用链是什么？',reason:'缺少 Project source evidence。',kind:'missing_fact',blocking:true,evidenceIds:[]};
function state(){return{version:1,current:{resultMode:'analysis',evidence:[],claims:[],gaps:[gap],recommendations:[],steps:[]},turns:[]};}
function decision(kind,overrides={}){return{kind,summary:'bounded control',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[],...overrides};}

test('a certified blocking Gap does not revoke an otherwise-governed evidence-acquisition Work Unit',async()=>{
  const work={id:'WU-SOURCE',title:'读取源码补齐证据',goal:'确认 Human Gateway 恢复执行调用链',expectedOutput:'返回源码定位',stopCondition:'定位链路或形成项目内 blocker',projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']};
  const task={id:'T-GAP',title:'blocking Gap acquisition',instruction:'基于当前项目源码确认调用链。',projectScopes:[{path:process.cwd(),label:'TaskBoard'}],attachments:[],references:[],taskContract:{authority:{}},analysisState:state(),workReceipts:[]};
  const compiler=new GovernanceCompiler();assert.equal(compiler.compileForRole(task,'subagent',{workUnit:work}).authorizedGrant.projectAccess,'read');
  let rootCalls=0,subagentCalls=0;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){rootCalls+=1;onExecutionStarted?.();if(!subagentResults.length)return decision('delegate',{delegations:[work]});return decision('human_gateway',{gateway:{gapId:gap.id,question:gap.question,context:gap.reason,options:[]}});},
    async runSubagent({delegation,onExecutionStarted}){subagentCalls+=1;onExecutionStarted?.();assert.equal(delegation.id,'WU-SOURCE');return{delegationId:delegation.id,result:'bounded Project acquisition executed',evidence:[],blocker:null};},
  };
  const router=new ModelRouter(),runtime=new RootRuntime({executor,modelRouter:router,subagentRuntime:new SubagentRuntime({executor,modelRouter:router}),validatorRuntime:new ValidatorRuntime(),governanceCompiler:compiler});
  const outcome=await runtime.execute(task);
  assert.equal(outcome.kind,'needs_human');assert.equal(outcome.gateway.targetGapId,gap.id);assert.equal(subagentCalls,1);assert.equal(rootCalls,2);
});
