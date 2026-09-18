import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRootExecutorRequest, compileSubagentExecutorRequest } from '../src/core/executor-contract.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { compileAuthorizedGrant } from '../src/governance/governance-compiler.js';

function governedTask(){
  return{
    id:'T-PARENT',title:'parent binding',instruction:'achieve the governed outcome',
    projectScopes:[],attachments:[],references:[],
    taskContract:{
      id:'TC-T-PARENT',revision:3,
      authority:{},
      obligations:[{
        id:'OBL-T-PARENT-GOAL',certification:'supported',
        requirementRefs:[{sourceId:'REQ-T-PARENT-0001',start:0,end:28}],
        criterion:{mode:'outcome',acceptedOutcomes:['succeeded']},
      }],
      constraints:[{id:'C-NO-BYPASS',kind:'parent_invariant',statement:'Do not bypass the governed parent boundary.'}],
    },
  };
}

function boundedWork(){
  return{
    id:'WU-1',title:'inspect one discriminator',goal:'inspect one bounded fact',expectedOutput:'one observed fact',stopCondition:'fact or blocker returned',
    projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[],
  };
}

const expectedParentGovernance={
  contractId:'TC-T-PARENT',revision:3,
  obligations:[{
    id:'OBL-T-PARENT-GOAL',certification:'supported',
    requirementRefs:[{sourceId:'REQ-T-PARENT-0001',start:0,end:28}],
    criterion:{mode:'outcome',acceptedOutcomes:['succeeded']},
  }],
  constraints:[{id:'C-NO-BYPASS',kind:'parent_invariant',statement:'Do not bypass the governed parent boundary.'}],
};

test('Root receives the governed parent contract instead of relying on conversational memory',()=>{
  const request=compileRootExecutorRequest({task:governedTask(),certifiedContext:{claims:[],gaps:[],unresolvedObligations:[]}});
  assert.deepEqual(request.context.parentGovernance,expectedParentGovernance);
  assert.match(request.instructions,/parentGovernance is the inherited Task-level boundary/);
  assert.match(request.instructions,/Local usefulness alone is not sufficient/);
});

test('Subagent compiler receives the same parent boundary but remains a bounded executor',()=>{
  const task=governedTask();
  const request=compileSubagentExecutorRequest({task,delegation:boundedWork()});
  assert.deepEqual(request.context.parentGovernance,expectedParentGovernance);
  assert.match(request.instructions,/Respect its obligations and constraints before acting/);
  assert.match(request.instructions,/do not work around it/);
  assert.match(request.instructions,/A local result never proves a parent obligation or Task completion/);

  request.context.parentGovernance.constraints[0].statement='mutated';
  assert.equal(task.taskContract.constraints[0].statement,'Do not bypass the governed parent boundary.','Runtime context must not alias durable Task state');
});

test('actual SubagentRuntime scoping preserves parent governance into the executor request',async()=>{
  let seen=null;
  const executor={
    async runSubagent({task,delegation}){
      const request=compileSubagentExecutorRequest({task,delegation});
      seen=request.context.parentGovernance;
      return{delegationId:delegation.id,result:'observed',evidence:[],blocker:null};
    },
  };
  const modelRouter={prepare:async()=>{},route:()=>({})};
  const runtime=new SubagentRuntime({executor,modelRouter});
  const result=await runtime.run(governedTask(),boundedWork());
  assert.equal(result.result,'observed');
  assert.deepEqual(seen,expectedParentGovernance,'Task input scoping must not erase the parent TaskContract before Executor compilation');
});

test('semantic parent governance cannot widen the executable AuthorizedGrant',()=>{
  const task=governedTask();
  task.projectScopes=[{path:'/project',label:'project'}];
  task.taskContract.constraints.push({id:'C-WRITE-WISH',kind:'parent_invariant',statement:'Local work would like write access.'});
  const grant=compileAuthorizedGrant({
    role:'subagent',task,
    workUnit:{...boundedWork(),projectAccess:'write',networkAccess:true,inputRefs:['project:0']},
  });
  assert.equal(grant.projectAccess,'read','parent semantic context cannot manufacture project-write authority');
  assert.equal(grant.networkAccess,false,'parent semantic context cannot manufacture network authority');
});

test('missing TaskContract produces an explicit empty parent boundary rather than invented governance',()=>{
  const task={id:'T-EMPTY',title:'empty',instruction:'inspect',projectScopes:[],attachments:[],references:[]};
  const request=compileSubagentExecutorRequest({task,delegation:{id:'WU-1'}});
  assert.deepEqual(request.context.parentGovernance,{contractId:null,revision:null,obligations:[],constraints:[]});
});
