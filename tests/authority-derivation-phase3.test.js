import test from 'node:test';
import assert from 'node:assert/strict';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { validateDelegationPlan } from '../src/core/root-runtime.js';

const supported=value=>({value,certification:'supported',requirement_refs:[]});
const unresolved=value=>({value,certification:'unresolved',requirement_refs:[]});
const task=(instruction,authority)=>({id:'T',title:'authority',instruction,taskContract:{authority},projectScopes:[{path:'/project'}]});
const writeWork={id:'WU-W',title:'change',goal:'change project',expectedOutput:'changed project',stopCondition:'done',projectAccess:'write',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']};
function grantFor(t,work=writeWork){return new GovernanceCompiler().compileForRole(t,'subagent',{workUnit:work}).authorizedGrant;}

test('certified TaskContract authority, not Task wording, decides project write authority',()=>{
  const authority={projectWrite:supported(true)};
  assert.equal(grantFor(task('只分析当前实现。',authority)).projectAccess,'write');
  assert.equal(grantFor(task('请立即修改项目代码。',authority)).projectAccess,'write');
});

test('unresolved write authority narrows a write request to read',()=>{
  assert.equal(grantFor(task('请立即修改项目代码。',{projectWrite:unresolved(true)})).projectAccess,'read');
});

test('network authority requires both certified TaskContract support and Work Unit request',()=>{
  const compiler=new GovernanceCompiler(),work={...writeWork,projectAccess:'none',inputRefs:[],networkAccess:true};
  assert.equal(compiler.compileForRole(task('分析资料',{networkAccess:supported(true)}),'subagent',{workUnit:work}).authorizedGrant.networkAccess,true);
  assert.equal(compiler.compileForRole(task('请联网搜索',{networkAccess:unresolved(true)}),'subagent',{workUnit:work}).authorizedGrant.networkAccess,false);
});

test('RootRuntime delegation validation is structural and has no task-mode authority branch',()=>{
  const checked=validateDelegationPlan([writeWork],{availableInputRefs:['project:0']});
  assert.equal(checked.valid,true);assert.deepEqual(checked.issues,[]);
});

test('Root remains statically narrowed even when Task grants mutation capabilities',()=>{
  const compiler=new GovernanceCompiler(),t=task('请修改项目代码。',{projectWrite:supported(true),networkAccess:supported(true)}),policy=compiler.compileForRole(t,'root');
  assert.equal(policy.authorizedGrant.projectAccess,'none');
  assert.equal(policy.authorizedGrant.networkAccess,false);
});
