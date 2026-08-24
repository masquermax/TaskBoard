import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { ROOT_RESPONSE_CONTRACT, SUBAGENT_RESPONSE_CONTRACT } from '../src/core/executor-contract.js';
import { validateDelegationPlan } from '../src/core/root-runtime.js';

const rootDir=resolve('.');
function demoSkillLibrary(){const skill={id:'source-investigation',purpose:['demo external method'],raw:'# source-investigation\n\nMethod:\n- targeted lookup'};return{list(){return[{id:skill.id,purpose:'demo external method',applicableWork:[]}]},get(id){return id===skill.id?skill:null},has(id){return id===skill.id}};}

test('Capability Map exposes one compact Runtime owner chain',()=>{
  const map=readFileSync(resolve(rootDir,'docs/CAPABILITY_MAP.md'),'utf8');
  for(const phrase of ['Scheduler 管生命周期','Root 判断','Subagent 执行','Validator 核来源','Task Core 持久化'])assert.match(map,new RegExp(phrase));
  assert.match(map,/Validator model \/ semantic proof \/ repair loop：不存在/);
  assert.match(map,/Runtime telemetry wrapper \/ semantic observability owner：不存在/);
});

test('GovernanceCompiler projects authority and selected method only',()=>{
  const compiler=new GovernanceCompiler({skillLibrary:demoSkillLibrary()}),task={title:'需求分析',instruction:'根据附件与项目分析',projectScopes:[]};
  const root=compiler.compileForRole(task,'root');
  const subagent=compiler.compileForRole(task,'subagent',{skillId:'source-investigation',workUnit:{projectAccess:'none',networkAccess:false,inputRefs:[]}});
  assert.deepEqual(root.authorizedGrant,{role:'root',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',environmentAccess:'none'});
  assert.equal(root.skillCatalog.length,1);
  assert.deepEqual(subagent.skillCatalog,[]);
  assert.equal(subagent.selectedSkill.id,'source-investigation');
  assert.match(root.prompt,/ROLE ROOT/);assert.match(subagent.prompt,/ROLE SUBAGENT/);assert.match(subagent.prompt,/SELECTED METHOD/);
  for(const prompt of [root.prompt,subagent.prompt])assert.doesNotMatch(prompt,/PRODUCT CONSTITUTION|CAPABILITY CONTRACT|C-001|C-003/);
  assert.equal('documents' in compiler,false,'product documents must not become a second Runtime data plane');
});

test('Core response contracts contain only Root and Subagent owned controls',()=>{
  assert.ok(ROOT_RESPONSE_CONTRACT.properties.delegations);assert.ok(ROOT_RESPONSE_CONTRACT.properties.gateway);assert.equal('stageResult' in ROOT_RESPONSE_CONTRACT.properties,false);
  assert.deepEqual(Object.keys(SUBAGENT_RESPONSE_CONTRACT.properties).sort(),['blocker','delegationId','evidence','result']);
  for(const key of ['claims','gaps','recommendations','delegations','gateway','findings','discoveries','uncertainty'])assert.equal(key in SUBAGENT_RESPONSE_CONTRACT.properties,false);
});

test('Work Unit capability request is structural and fails closed when omitted',()=>{
  const base={id:'w1',title:'改代码',goal:'修改目标文件',expectedOutput:'返回修改结果',stopCondition:'修改完成并返回后停止',projectAccess:'write',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']};
  const options={availableInputRefs:['project:0']};
  const valid=validateDelegationPlan([base],options);assert.equal(valid.valid,true);assert.equal(valid.delegations[0].projectAccess,'write');
  const omitted=validateDelegationPlan([{...base,id:'w2',projectAccess:undefined,networkAccess:undefined,inputRefs:[]}],options);assert.equal(omitted.valid,true);assert.equal(omitted.delegations[0].projectAccess,'none');assert.equal(omitted.delegations[0].networkAccess,false);
});

test('active Runtime source tree contains no removed governance/telemetry loader files',()=>{
  for(const path of ['src/governance/governance-loader.js','src/governance/capability-contract-loader.js','src/core/runtime-telemetry.js'])assert.equal(existsSync(resolve(rootDir,path)),false,path);
});

test('Capability Map points only to existing current source files',()=>{
  const map=readFileSync(resolve(rootDir,'docs/CAPABILITY_MAP.md'),'utf8'),paths=[...map.matchAll(/`(src\/[^`]+?\.js)`/g)].map(match=>match[1]);
  assert.ok(paths.length>0);for(const path of paths)assert.equal(existsSync(resolve(path)),true,`stale implementation-map path: ${path}`);
});
