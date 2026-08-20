import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { roleCapabilityContract } from '../src/governance/role-capability-contract.js';
import { rootSchema, subagentSchema } from '../src/extensions/executors/codex/codex-executor.js';
import { validateDelegationPlan } from '../src/core/root-runtime.js';

const rootDir=resolve('.');
const expectedContracts=['SCHEDULER','ROOT','WORK_UNIT','SUBAGENT','VALIDATOR','TASK_CORE','HUMAN_GATEWAY','SKILL','EXECUTOR','UI_SURFACE'];
function demoSkillLibrary(){const skill={id:'source-investigation',purpose:['demo external method'],raw:'# source-investigation\n\nMethod:\n- read the targeted source'};return{list(){return[{id:skill.id,purpose:'demo external method',applicableWork:[]}]},get(id){return id===skill.id?skill:null},has(id){return id===skill.id}};}

test('human-readable Capability Contracts remain documentation, not a Runtime parser/data plane',()=>{
  const doc=readFileSync(resolve(rootDir,'docs/CAPABILITY_CONTRACTS.md'),'utf8');
  for(const id of expectedContracts)assert.match(doc,new RegExp(`^## ${id}$`,'m'),id);
  assert.equal(existsSync(resolve(rootDir,'src/governance/capability-contract-loader.js')),false);
  assert.equal(existsSync(resolve(rootDir,'src/governance/governance-loader.js')),false);
  const compiler=new GovernanceCompiler();for(const key of ['documents','contracts','fingerprint'])assert.equal(key in compiler,false,key);
});

test('machine execution grants exist only for roles that actually execute through Executor',()=>{
  assert.equal(roleCapabilityContract('root').id,'ROOT');assert.equal(roleCapabilityContract('subagent').id,'SUBAGENT');assert.equal(roleCapabilityContract('validator'),null);
  const compiler=new GovernanceCompiler({skillLibrary:demoSkillLibrary()}),task={id:'T',projectScopes:[{path:'/project'}],taskContract:{authority:{}}},root=compiler.compileForRole(task,'root'),subagent=compiler.compileForRole(task,'subagent',{skillId:'source-investigation',workUnit:{projectAccess:'read',networkAccess:false,inputRefs:['project:0']}});
  assert.equal(root.authorizedGrant.role,'root');assert.equal(subagent.authorizedGrant.role,'subagent');assert.equal(subagent.selectedSkill.id,'source-investigation');assert.match(subagent.prompt,/SELECTED METHOD/);for(const key of ['taskMode','roleGuide','contract','fingerprint'])assert.equal(key in root,false,key);
});

test('Agent schemas expose only Root judgment/control and Subagent execution output',()=>{
  assert.ok(rootSchema.properties.delegations);assert.ok(rootSchema.properties.gateway);assert.deepEqual(rootSchema.properties.evidence.items.properties.sourceType.enum,['human','reference']);
  assert.deepEqual([...subagentSchema.required].sort(),['blocker','delegationId','evidence','result']);assert.deepEqual(Object.keys(subagentSchema.properties).sort(),['blocker','delegationId','evidence','result']);
  for(const key of ['findings','discoveries','uncertainty','claims','gaps','recommendations','delegations','gateway'])assert.equal(key in subagentSchema.properties,false);
});

test('TaskBoard core ships no concrete Skill content; Skill is injected per Work Unit',()=>{
  assert.equal(existsSync(resolve(rootDir,'skills')),false);const empty=new GovernanceCompiler();assert.deepEqual(empty.skillCatalog(),[]);
  const compiler=new GovernanceCompiler({skillLibrary:demoSkillLibrary()}),subagent=compiler.compileForRole({id:'T',projectScopes:[],taskContract:{authority:{}}},'subagent',{skillId:'source-investigation',workUnit:{projectAccess:'none',networkAccess:false,inputRefs:[]}});assert.equal(subagent.selectedSkill.id,'source-investigation');assert.match(subagent.prompt,/SELECTED METHOD/);
});

test('Work Unit capability request is structural and independent of presentation classifiers',()=>{
  const base={id:'w1',title:'改代码',goal:'修改目标文件',expectedOutput:'返回修改结果',stopCondition:'修改完成并返回后停止',projectAccess:'write',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']},checked=validateDelegationPlan([base],{availableInputRefs:['project:0']});assert.equal(checked.valid,true);assert.equal(checked.delegations[0].projectAccess,'write');
  const omitted=validateDelegationPlan([{...base,id:'w2',projectAccess:undefined,networkAccess:undefined,inputRefs:[]}],{availableInputRefs:['project:0']});assert.equal(omitted.valid,true);assert.equal(omitted.delegations[0].projectAccess,'none');assert.equal(omitted.delegations[0].networkAccess,false);
});

test('owner-sensitive durable mutations stay behind their declared Core surfaces',()=>{
  const files=['src/core/scheduler.js','src/core/task-service.js','src/core/cleanup-controller.js','src/core/root-runtime.js','src/core/subagent-runtime.js','src/governance/validator-runtime.js','src/server/app.js','src/server/bootstrap.js'],source=Object.fromEntries(files.map(file=>[file,readFileSync(resolve(rootDir,file),'utf8')])),callers=pattern=>files.filter(file=>pattern.test(source[file]));
  for(const method of ['transitionTask','touchTask','setCancelRequested','setDeleted','setLocked','createGatewayRecord','resolveGatewayRecord','cancelPendingGateway'])assert.deepEqual(callers(new RegExp(`\\.repository\\.${method}\\(`)),['src/core/scheduler.js'],method);
  for(const method of ['createTask','createProject','deleteProject'])assert.deepEqual(callers(new RegExp(`\\.repository\\.${method}\\(`)),['src/core/task-service.js'],method);
  assert.deepEqual(callers(/\.repository\.hardDeleteCompletedTask\(/),['src/core/cleanup-controller.js']);
});
