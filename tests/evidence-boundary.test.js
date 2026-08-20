import test from 'node:test';
import assert from 'node:assert/strict';
import { ROOT_RESPONSE_CONTRACT, SUBAGENT_RESPONSE_CONTRACT, compileRootExecutorRequest, compileSubagentExecutorRequest } from '../src/core/executor-contract.js';
import { RootRuntime, validateDelegationPlan } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { ModelRouter } from '../src/core/model-router.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';

function demoSkillLibrary(){const skill={id:'source-investigation',purpose:['demo method'],raw:'# source-investigation\n\nMethod:\n- targeted lookup'};return{list(){return[{id:skill.id,purpose:'demo method',applicableWork:[]}]},get(id){return id===skill.id?skill:null},has(id){return id===skill.id}};}

test('Core response contracts expose only controls owned by Root and Subagent',()=>{
  for(const key of ['resultMode','evidence','claims','gaps','recommendations','steps','delegations','gateway'])assert.ok(ROOT_RESPONSE_CONTRACT.required.includes(key));
  assert.deepEqual([...SUBAGENT_RESPONSE_CONTRACT.required].sort(),['blocker','delegationId','evidence','result']);
  assert.deepEqual(Object.keys(SUBAGENT_RESPONSE_CONTRACT.properties).sort(),['blocker','delegationId','evidence','result']);
  for(const key of ['findings','discoveries','uncertainty','claims','gaps','recommendations','delegations','gateway'])assert.equal(key in SUBAGENT_RESPONSE_CONTRACT.properties,false);
});

test('Work Unit contract requires positive goal/output/stop boundaries',()=>{
  const invalid=validateDelegationPlan([{id:'w',title:'查调用链',goal:'定位入口',dependsOn:[],skillId:null}]);
  assert.equal(invalid.valid,false);assert.match(invalid.issues.join(' '),/expectedOutput/);assert.match(invalid.issues.join(' '),/stopCondition/);
  const valid=validateDelegationPlan([{id:'w',title:'查调用链',goal:'定位入口',expectedOutput:'返回入口与直接调用证据',stopCondition:'入口与直接调用关系已闭合或形成明确 blocker',projectAccess:'none',networkAccess:false,dependsOn:[],inputRefs:[],skillId:null}]);
  assert.equal(valid.valid,true);
});

test('Core compiles compact role instructions plus optional selected Skill without product governance documents',()=>{
  const compiler=new GovernanceCompiler({skillLibrary:demoSkillLibrary()}),task={id:'T-1',title:'分析需求',instruction:'根据附件和项目给步骤',projectScopes:[],attachments:[],references:[]};
  const rootRequest=compileRootExecutorRequest({task,subagentResults:[],humanGatewayHistory:[],policyContext:compiler.compileForRole(task,'root'),certifiedContext:{claims:[],gaps:[],unresolvedObligations:[]}});
  assert.match(rootRequest.instructions,/ROLE ROOT/);assert.match(rootRequest.instructions,/sole Task-level/i);assert.match(rootRequest.instructions,/fixed point/i);assert.doesNotMatch(rootRequest.instructions,/PRODUCT CONSTITUTION|C-001|CAPABILITY CONTRACT/);
  const work={id:'w',title:'查证',goal:'定位一个事实',expectedOutput:'证据',stopCondition:'事实闭合',projectAccess:'none',networkAccess:false,inputRefs:[],dependsOn:[],skillId:'source-investigation'};
  const subRequest=compileSubagentExecutorRequest({task,delegation:work,policyContext:compiler.compileForRole(task,'subagent',{skillId:'source-investigation',workUnit:work})});
  assert.match(subRequest.instructions,/ROLE SUBAGENT/);assert.match(subRequest.instructions,/SELECTED METHOD/);assert.match(subRequest.instructions,/Do not classify Task truth, confidence/i);assert.doesNotMatch(subRequest.instructions,/PRODUCT CONSTITUTION|C-001|CAPABILITY CONTRACT/);
});

test('governed Candidate fails closed when ValidatorRuntime is absent',async()=>{
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),validatorRuntime:null,executor:{},modelRouter:new ModelRouter(),subagentRuntime:{}}),task={id:'T-NO-VALIDATOR',title:'分析',instruction:'分析',projectScopes:[],attachments:[],references:[]},session=root.createSession(task);
  await assert.rejects(root.reviewRootDecision(task,session,{kind:'complete',resultMode:'analysis',evidence:[],claims:[],gaps:[{id:'G-1',question:'待确认事实是什么？',reason:'当前缺少证据',kind:'missing_fact',blocking:false,evidenceIds:[]}],recommendations:[],steps:[],gapResolutions:[],delegations:[],gateway:null},{},{triggerRefs:['task:T-NO-VALIDATOR']}),/VALIDATOR_RUNTIME_REQUIRED/);
});
