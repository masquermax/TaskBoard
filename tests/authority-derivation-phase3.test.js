import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { validateDelegationPlan } from '../src/core/root-runtime.js';

const rootDir=resolve('.');
const supported=value=>({value,certification:'supported',requirement_refs:[]});
const unresolved=value=>({value,certification:'unresolved',requirement_refs:[]});
const task=(instruction,authority)=>({title:'authority',instruction,taskContract:{authority},projectScopes:[{path:'/project'}]});
const writeWork={id:'WU-W',title:'change',goal:'change project',expectedOutput:'changed project',stopCondition:'done',projectAccess:'write',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']};

function grantFor(t,work=writeWork){
  const policy=new GovernanceCompiler({rootDir}).compileForRole(t,'subagent',{workUnit:work});
  assert.ok(policy.authorizedGrant,'GovernanceCompiler must expose the sole AuthorizedGrant');
  assert.equal('executionGrant' in policy,false,'legacy executionGrant must not remain as a competing authority surface');
  return policy.authorizedGrant;
}

test('certified TaskContract authority, not Task wording, decides project write authority',()=>{
  const authority={projectWrite:supported(true)};
  const analysisWording=grantFor(task('只分析当前实现，不要自行猜测。',authority));
  const executionWording=grantFor(task('请立即修改项目代码。',authority));
  assert.equal(analysisWording.projectAccess,'write');
  assert.equal(executionWording.projectAccess,'write');
});

test('unresolved write authority narrows a write request to read instead of letting wording expand it',()=>{
  const grant=grantFor(task('请立即修改项目代码。',{projectWrite:unresolved(true)}));
  assert.equal(grant.projectAccess,'read');
});

test('network authority requires both certified TaskContract support and Work Unit request',()=>{
  const compiler=new GovernanceCompiler({rootDir});
  const base={...writeWork,projectAccess:'none',inputRefs:[],networkAccess:true};
  const allowed=compiler.compileForRole(task('分析资料',{networkAccess:supported(true)}),'subagent',{workUnit:base});
  const unresolvedPolicy=compiler.compileForRole(task('请联网搜索',{networkAccess:unresolved(true)}),'subagent',{workUnit:base});
  assert.equal(allowed.authorizedGrant.networkAccess,true);
  assert.equal(unresolvedPolicy.authorizedGrant.networkAccess,false);
});

test('RootRuntime delegation validation is structural and no longer owns Task write authority',()=>{
  const options={availableInputRefs:['project:0']};
  const analysis=validateDelegationPlan([writeWork],{taskMode:'analysis',...options});
  const execution=validateDelegationPlan([writeWork],{taskMode:'execution',...options});
  assert.equal(analysis.valid,true);
  assert.equal(execution.valid,true);
  assert.deepEqual(analysis.issues,execution.issues);
});

test('Root and Validator remain statically narrowed regardless of certified Task write authority',()=>{
  const compiler=new GovernanceCompiler({rootDir});
  const t=task('请修改项目代码。',{projectWrite:supported(true),networkAccess:supported(true)});
  for(const role of ['root','validator']){
    const policy=compiler.compileForRole(t,role);
    assert.ok(policy.authorizedGrant);
    assert.equal(policy.authorizedGrant.projectAccess,'none');
    assert.equal(policy.authorizedGrant.networkAccess,false);
  }
});
