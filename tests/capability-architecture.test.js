import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCapabilityContracts } from '../src/governance/capability-contract-loader.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { rootSchema, subagentSchema, validatorSchema } from '../src/extensions/executors/codex/codex-executor.js';
import { validateDelegationPlan } from '../src/core/root-runtime.js';

const rootDir=resolve('.');
const expectedContracts=['SCHEDULER','ROOT','WORK_UNIT','SUBAGENT','VALIDATOR','TASK_CORE','HUMAN_GATEWAY','SKILL','EXECUTOR','UI_SURFACE'];
const contractFields=['identity','purpose','owns','capabilities','produces','handoff'];

function demoSkillLibrary(){
  const skill={
    id:'source-investigation',
    purpose:['demo external method'],
    applicablework:['bounded evidence lookup'],
    method:['read the targeted source'],
    contract:['preserve source-near evidence'],
    capabilityrequirements:['source_read'],
    stopcondition:['stop when the bounded question closes'],
    raw:'# source-investigation\n\nPurpose:\n- demo external method\n\nMethod:\n- read the targeted source\n\nContract:\n- preserve source-near evidence\n\nCapability Requirements:\n- source_read\n\nStop Condition:\n- stop when the bounded question closes',
  };
  return {
    list(){return[{id:skill.id,purpose:skill.purpose.join(' '),applicableWork:skill.applicablework}]},
    get(id){return id===skill.id?skill:null},
    has(id){return id===skill.id},
  };
}

test('Capability Contracts are the complete positive authority surface for every current core position',()=>{
  const contracts=loadCapabilityContracts(rootDir);
  assert.deepEqual(Object.keys(contracts),expectedContracts);
  for(const id of expectedContracts){
    for(const field of contractFields)assert.ok(Array.isArray(contracts[id][field])&&contracts[id][field].length,`${id}.${field} must be defined`);
  }
});

test('Capability Map names one owner for each critical decision and explicitly leaves Project Knowledge unimplemented',()=>{
  const map=readFileSync(resolve(rootDir,'docs/CAPABILITY_MAP.md'),'utf8');
  for(const pair of [
    ['Task lifecycle / admission','Scheduler'],
    ['Task reasoning / planning','Root'],
    ['One delegated Work Unit execution','Subagent'],
    ['Root Candidate certification / Gap narrowing','Validator'],
    ['Analysis History value decision','Validator'],
    ['Durable Task facts / Current Certified State / History write','Task Core'],
    ['Skill discovery / selected method','Skill'],
  ]){
    assert.match(map,new RegExp(`${pair[0].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}[^\\n]*${pair[1].replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}`));
  }
  assert.match(map,/Project Knowledge subsystem[^\n]*未实现/i);
});



test('runtime resource ownership stays singular: Scheduler admits work while Executor only reports execution facts',()=>{
  const integration=readFileSync(resolve(rootDir,'docs/CODEX_INTEGRATION.md'),'utf8');
  assert.match(integration,/Executor records the execution fact `activeTurnCount`/);
  assert.match(integration,/ceiling belongs to Scheduler and consumes Executor facts/);
  assert.doesNotMatch(integration,/Executor Resource Manager/i);
  const executorPort=readFileSync(resolve(rootDir,'src/core/executor-port.js'),'utf8');
  assert.match(executorPort,/Scheduler uses that fact as the/);
});

test('ordinary Runtime loads only Constitution and owned Capability; ADR remains outside the Runtime data plane',()=>{
  const runtimeCompiler=new GovernanceCompiler({rootDir});
  assert.ok(runtimeCompiler.documents.constitution.length>0);
  assert.deepEqual(Object.keys(runtimeCompiler.documents).sort(),['constitution','loadedAt']);
  const loader=readFileSync(resolve(rootDir,'src/governance/governance-loader.js'),'utf8');
  assert.doesNotMatch(loader,/ADR\.md|loadGovernanceDocuments|parseAcceptedMarkedSections/,'engineering history must not have a second Runtime loader');
});

test('runtime context is role-scoped: Root gets Root authority and Skill catalog, Subagent gets only Subagent authority plus selected Skill, Validator gets only certification authority',()=>{
  const compiler=new GovernanceCompiler({rootDir,skillLibrary:demoSkillLibrary()});
  const task={title:'需求分析',instruction:'根据附件与项目分析'};
  const root=compiler.compileForRole(task,'root');
  const subagent=compiler.compileForRole(task,'subagent',{skillId:'source-investigation'});
  const validator=compiler.compileForRole(task,'validator');

  assert.equal(root.contract.id,'ROOT');
  assert.equal(subagent.contract.id,'SUBAGENT');
  assert.equal(validator.contract.id,'VALIDATOR');
  assert.ok(root.skillCatalog.length>0);
  assert.deepEqual(subagent.skillCatalog,[]);
  assert.equal(subagent.selectedSkill.id,'source-investigation');
  assert.match(subagent.prompt,/SELECTED METHOD/);
  for(const prompt of [root.prompt,subagent.prompt,validator.prompt]){
    assert.doesNotMatch(prompt,/PRODUCT CONSTITUTION|C-001|C-002|C-003|C-004|C-005/,'ordinary role context must not re-inject the whole Constitution');
  }
  assert.doesNotMatch(root.prompt,/CAPABILITY CONTRACT — (SUBAGENT|VALIDATOR)/);
  assert.doesNotMatch(subagent.prompt,/CAPABILITY CONTRACT — (ROOT|VALIDATOR)/);
  assert.doesNotMatch(validator.prompt,/CAPABILITY CONTRACT — (ROOT|SUBAGENT)/);
});

test('Agent schemas expose owned controls rather than relying on negative prompt rules',()=>{
  assert.ok(rootSchema.properties.delegations);
  assert.ok(rootSchema.properties.gateway);
  assert.ok(rootSchema.properties.delegations.items.properties.projectAccess);
  assert.ok(rootSchema.properties.delegations.items.required.includes('projectAccess'));
  assert.equal(rootSchema.properties.kind.enum.includes('checkpoint'),false,'History has no special Root checkpoint control path');
  assert.equal('progressCommits' in rootSchema.properties,false);
  assert.deepEqual(rootSchema.properties.evidence.items.properties.sourceType.enum,['human','reference'],'Root schema exposes only evidence sources present in Root context');

  assert.equal('delegations' in subagentSchema.properties,false);
  assert.equal('gateway' in subagentSchema.properties,false);
  assert.equal('progressCommits' in subagentSchema.properties,false);
  assert.ok(subagentSchema.properties.discoveries,'Subagent can hand out-of-scope discoveries back to Root without taking planning authority');

  assert.deepEqual(Object.keys(validatorSchema.properties),['reviews']);
});

test('TaskBoard core ships no concrete Skill content; a Skill library is an injected dependency',()=>{
  assert.equal(existsSync(resolve(rootDir,'skills')),false,'concrete Skill assets belong outside the core package');
  const empty=new GovernanceCompiler({rootDir});
  assert.deepEqual(empty.skillCatalog(),[]);
  assert.equal(empty.hasSkill('source-investigation'),false);

  const compiler=new GovernanceCompiler({rootDir,skillLibrary:demoSkillLibrary()});
  assert.ok(compiler.skillCatalog().some(skill=>skill.id==='source-investigation'));
  const subagent=compiler.compileForRole({title:'分析',instruction:'分析'},'subagent',{skillId:'source-investigation'});
  assert.equal(subagent.selectedSkill.id,'source-investigation');
  assert.match(subagent.prompt,/SELECTED METHOD/);
});


test('Work Unit project write access is explicit and cannot be granted inside an analysis Task',()=>{
  const base={id:'w1',title:'改代码',goal:'修改目标文件',expectedOutput:'返回修改结果',stopCondition:'修改完成并返回后停止',projectAccess:'write',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']};
  const options={availableInputRefs:['project:0']};
  const analysis=validateDelegationPlan([base],{taskMode:'analysis',...options});
  assert.equal(analysis.valid,false);
  assert.match(analysis.issues.join(' '),/只有明确 execution Task.*才能取得 Project Scope 写权限/);
  const auto=validateDelegationPlan([base],{taskMode:'auto',...options});
  assert.equal(auto.valid,false,'auto/ambiguous Task must not silently acquire project write authority');
  const execution=validateDelegationPlan([base],{taskMode:'execution',...options});
  assert.equal(execution.valid,true);
  assert.equal(execution.delegations[0].projectAccess,'write');
  const omitted=validateDelegationPlan([{...base,id:'w2',projectAccess:undefined,networkAccess:undefined,inputRefs:[]}],{taskMode:'analysis',...options});
  assert.equal(omitted.valid,true,'legacy/custom adapters fail closed instead of inheriting Project/network capability');
  assert.equal(omitted.delegations[0].projectAccess,'none');
  assert.equal(omitted.delegations[0].networkAccess,false);
});

test('owner-sensitive durable mutations stay behind their declared Capability owner surfaces',()=>{
  const files=[
    'src/core/scheduler.js',
    'src/core/task-service.js',
    'src/core/cleanup-controller.js',
    'src/core/root-runtime.js',
    'src/core/subagent-runtime.js',
    'src/governance/validator-runtime.js',
    'src/server/app.js',
    'src/server/bootstrap.js',
  ];
  const source=Object.fromEntries(files.map(file=>[file,readFileSync(resolve(rootDir,file),'utf8')]));
  const callers=(pattern)=>files.filter(file=>pattern.test(source[file]));

  // Lifecycle and user lifecycle actions belong to Scheduler. Repository method
  // definitions are intentionally outside this scan; these assertions cover callers.
  for(const method of ['transitionTask','touchTask','setCancelRequested','setDeleted','setLocked','createGatewayRecord','resolveGatewayRecord','cancelPendingGateway']){
    assert.deepEqual(callers(new RegExp(`\\.repository\\.${method}\\(`)),['src/core/scheduler.js'],`${method} must remain Scheduler-owned at call sites`);
  }

  // Durable Task / registry creation is Task Core work, not Root/Validator work.
  for(const method of ['createTask','createProject','deleteProject']){
    assert.deepEqual(callers(new RegExp(`\\.repository\\.${method}\\(`)),['src/core/task-service.js'],`${method} must remain on the Task Core service surface`);
  }

  // Physical retention cleanup is a deterministic Task Core maintenance path.
  assert.deepEqual(callers(/\.repository\.hardDeleteCompletedTask\(/),['src/core/cleanup-controller.js']);
  assert.deepEqual(callers(/\.repository\.setMaintenanceState\(/),['src/core/cleanup-controller.js']);

  // Validator decides History value, but only the Scheduler -> Task Core callback
  // is allowed to execute the durable History/stage write in the orchestration path.
  for(const method of ['commitProgressHistory','updateStageResult']){
    assert.deepEqual(callers(new RegExp(`\\.repository\\.${method}\\(`)),['src/core/scheduler.js'],`${method} must not leak into Agent/Validator code`);
  }
});


test('Capability Map points only to existing current source files and no removed role entry',()=>{
  const map=readFileSync(resolve('docs/CAPABILITY_MAP.md'),'utf8');
  const paths=[...map.matchAll(/`(src\/[^`]+?\.js)`/g)].map(match=>match[1]);
  assert.ok(paths.length>0);
  for(const path of paths)assert.equal(existsSync(resolve(path)),true,`stale implementation-map path: ${path}`);
  assert.doesNotMatch(map,/worker-runtime|lead-runtime|runWorker|runLead|ExecutionAdapterPort/);
});
