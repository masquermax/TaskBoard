import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexExecutor, rootSchema, subagentSchema } from '../src/extensions/executors/codex/codex-executor.js';
import { RootRuntime, validateDelegationPlan } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { ModelRouter } from '../src/core/model-router.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';

function demoSkillLibrary(){const skill={id:'source-investigation',purpose:['demo method'],raw:'# source-investigation\n\nMethod:\n- targeted lookup'};return{list(){return[{id:skill.id,purpose:'demo method',applicableWork:[]}]},get(id){return id===skill.id?skill:null},has(id){return id===skill.id}};}
class NoopClient{async health(){return{available:true,connected:true,authenticated:true};}close(){}}

test('model schemas expose only controls owned by Root and Subagent',()=>{
  for(const key of ['resultMode','evidence','claims','gaps','recommendations','steps','delegations','gateway'])assert.ok(rootSchema.required.includes(key));
  assert.deepEqual([...subagentSchema.required].sort(),['blocker','delegationId','evidence','result']);
  assert.deepEqual(Object.keys(subagentSchema.properties).sort(),['blocker','delegationId','evidence','result']);
  for(const key of ['findings','discoveries','uncertainty','claims','gaps','recommendations','delegations','gateway'])assert.equal(key in subagentSchema.properties,false);
});

test('Work Unit contract requires positive goal/output/stop boundaries',()=>{
  const invalid=validateDelegationPlan([{id:'w',title:'查调用链',goal:'定位入口',dependsOn:[],skillId:null}]);
  assert.equal(invalid.valid,false);assert.match(invalid.issues.join(' '),/expectedOutput/);assert.match(invalid.issues.join(' '),/stopCondition/);
  const valid=validateDelegationPlan([{id:'w',title:'查调用链',goal:'定位入口',expectedOutput:'返回入口与直接调用证据',stopCondition:'入口与直接调用关系已闭合或形成明确 blocker',projectAccess:'none',networkAccess:false,dependsOn:[],inputRefs:[],skillId:null}]);
  assert.equal(valid.valid,true);
});

test('Executor prompt combines a compact role boundary with optional selected Skill, not product governance documents',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-evidence-')),executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client:new NoopClient()}),compiler=new GovernanceCompiler({skillLibrary:demoSkillLibrary()}),task={id:'T-1',title:'分析需求',instruction:'根据附件和项目给步骤',projectScopes:[],attachments:[],references:[]};
  try{
    const rootPrompt=executor.rootPrompt({task,subagentResults:[],humanGatewayHistory:[],policyContext:compiler.compileForRole(task,'root'),certifiedContext:{claims:[],gaps:[],unresolvedObligations:[]}});
    assert.match(rootPrompt,/ROLE ROOT/);assert.match(rootPrompt,/sole Task-level judgment/i);assert.match(rootPrompt,/fixed point/i);assert.doesNotMatch(rootPrompt,/PRODUCT CONSTITUTION|C-001|CAPABILITY CONTRACT/);
    const subPrompt=executor.subagentPrompt({task,delegation:{id:'w',title:'查证',goal:'定位一个事实',expectedOutput:'证据',stopCondition:'事实闭合',projectAccess:'none',networkAccess:false,inputRefs:[],dependsOn:[],skillId:'source-investigation'},policyContext:compiler.compileForRole(task,'subagent',{skillId:'source-investigation',workUnit:{projectAccess:'none',networkAccess:false,inputRefs:[]}})});
    assert.match(subPrompt,/ROLE SUBAGENT/);assert.match(subPrompt,/SELECTED METHOD/);assert.match(subPrompt,/Do not classify Task truth, confidence/i);assert.doesNotMatch(subPrompt,/PRODUCT CONSTITUTION|C-001|CAPABILITY CONTRACT/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('governed Candidate fails closed when ValidatorRuntime is absent',async()=>{
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),validatorRuntime:null,executor:{},modelRouter:new ModelRouter(),subagentRuntime:{}}),task={id:'T-NO-VALIDATOR',title:'分析',instruction:'分析',projectScopes:[],attachments:[],references:[]},session=root.createSession(task);
  await assert.rejects(root.reviewRootDecision(task,session,{kind:'complete',resultMode:'analysis',evidence:[],claims:[],gaps:[{id:'G-1',question:'待确认事实是什么？',reason:'当前缺少证据',kind:'missing_fact',blocking:false,evidenceIds:[]}],recommendations:[],steps:[],gapResolutions:[],delegations:[],gateway:null},{},{triggerRefs:['task:T-NO-VALIDATOR']}),/VALIDATOR_RUNTIME_REQUIRED/);
});
