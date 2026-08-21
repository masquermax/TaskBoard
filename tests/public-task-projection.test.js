import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskService } from '../src/core/task-service.js';

test('public Task projection exposes persisted lifecycle reason but hides governed Completion inputs',()=>{
  const service=new TaskService({});
  const visible=service.publicTask({
    id:'T-UI',status:'COMPLETED',completion_reason:'SUCCESS',final_result:'done',
    taskContract:{obligations:[{id:'OBL-1'}]},requirementSources:[{id:'REQ-1'}],
    analysisState:{claims:[]},workReceipts:[{id:'WR-1'}],execution_state:{},
  });
  assert.equal(visible.completion_reason,'SUCCESS');
  assert.equal(visible.final_result,'done');
  assert.equal('taskContract' in visible,false);
  assert.equal('requirementSources' in visible,false);
  assert.equal('analysisState' in visible,false);
  assert.equal('workReceipts' in visible,false);
});
