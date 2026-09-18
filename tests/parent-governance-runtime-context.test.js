import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRootExecutorRequest, compileSubagentExecutorRequest } from '../src/core/executor-contract.js';

function governedTask(){
  return{
    id:'T-PARENT',title:'parent binding',instruction:'achieve the governed outcome',
    projectScopes:[],attachments:[],references:[],
    taskContract:{
      id:'TC-T-PARENT',revision:3,
      obligations:[{
        id:'OBL-T-PARENT-GOAL',certification:'supported',
        requirementRefs:[{sourceId:'REQ-T-PARENT-0001',start:0,end:28}],
        criterion:{mode:'outcome',acceptedOutcomes:['succeeded']},
      }],
      constraints:[{id:'C-NO-BYPASS',kind:'parent_invariant',statement:'Do not bypass the governed parent boundary.'}],
    },
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

test('Subagent receives the same parent boundary but remains a bounded executor',()=>{
  const task=governedTask();
  const request=compileSubagentExecutorRequest({
    task,
    delegation:{
      id:'WU-1',title:'inspect one discriminator',goal:'inspect one bounded fact',expectedOutput:'one observed fact',stopCondition:'fact or blocker returned',
      projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[],
    },
  });
  assert.deepEqual(request.context.parentGovernance,expectedParentGovernance);
  assert.match(request.instructions,/Respect its obligations and constraints before acting/);
  assert.match(request.instructions,/do not work around it/);
  assert.match(request.instructions,/A local result never proves a parent obligation or Task completion/);

  request.context.parentGovernance.constraints[0].statement='mutated';
  assert.equal(task.taskContract.constraints[0].statement,'Do not bypass the governed parent boundary.','Runtime context must not alias durable Task state');
});

test('missing TaskContract produces an explicit empty parent boundary rather than invented governance',()=>{
  const task={id:'T-EMPTY',title:'empty',instruction:'inspect',projectScopes:[],attachments:[],references:[]};
  const request=compileSubagentExecutorRequest({task,delegation:{id:'WU-1'}});
  assert.deepEqual(request.context.parentGovernance,{contractId:null,revision:null,obligations:[],constraints:[]});
});
