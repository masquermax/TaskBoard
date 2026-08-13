import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialTaskContractState, bootstrapTaskContractState } from '../src/governance/task-contract.js';

test('new TaskContract carries one canonical whole-Requirement obligation without storing Goal truth',()=>{
  const state=createInitialTaskContractState({taskId:'T-1',instruction:'检查 A、B、C 并给出完整结论'});
  assert.deepEqual(state.task_contract.obligations,[{
    id:'OBL-T-1-GOAL',
    certification:'supported',
    requirement_refs:[{source_id:'REQ-T-1-0001',start:0,end:15}],
    criterion:{mode:'outcome',acceptedOutcomes:['succeeded']},
  }]);
  assert.equal('goal_state' in state.task_contract,false);
});

test('legacy empty obligations bootstrap additively while existing governed obligations are preserved',()=>{
  const initial=createInitialTaskContractState({taskId:'T-2',instruction:'inspect'});
  const empty={...initial.task_contract,obligations:[]};
  const bootstrapped=bootstrapTaskContractState({id:'T-2',instruction:'changed',requirement_sources:initial.requirement_sources,task_contract:empty});
  assert.equal(bootstrapped.task_contract.obligations[0].id,'OBL-T-2-GOAL');
  const explicit={...initial.task_contract,obligations:[{id:'A',certification:'supported',requirement_refs:initial.task_contract.requirement_refs,criterion:{mode:'coverage'}}]};
  const preserved=bootstrapTaskContractState({id:'T-2',instruction:'changed',requirement_sources:initial.requirement_sources,task_contract:explicit});
  assert.deepEqual(preserved.task_contract.obligations,explicit.obligations);
});
