import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TaskService } from '../src/core/task-service.js';

const js=readFileSync(join(process.cwd(),'src/ui/app.js'),'utf8').replace(/\r\n/g,'\n');
const css=readFileSync(join(process.cwd(),'src/ui/app.css'),'utf8');

function loadCompletionPresentation(){
  const start=js.indexOf('function completionPresentation(');
  const end=js.indexOf('\nfunction taskCardTimes',start);
  assert.ok(start>=0&&end>start,'UI must expose one lifecycle-only completionPresentation function');
  const source=js.slice(start,end);
  return Function(`${source}; return completionPresentation;`)();
}

test('UI completion projection distinguishes explicit SUCCESS, CANCELLED, and missing completion reason',()=>{
  const present=loadCompletionPresentation();
  assert.deepEqual(present({status:'COMPLETED',completion_reason:'SUCCESS'}),{
    badge:'已完成',resultTitle:'最终结果',tone:'success',
  });
  assert.deepEqual(present({status:'COMPLETED',completion_reason:'CANCELLED'}),{
    badge:'已取消',resultTitle:'任务结果 · 已取消',tone:'cancelled',
  });
  assert.deepEqual(present({status:'COMPLETED',completion_reason:null}),{
    badge:'已结束',resultTitle:'任务结果 · 完成原因未确认',tone:'unresolved',
  });
  assert.deepEqual(present({status:'COMPLETED',completion_reason:'UNKNOWN'}),{
    badge:'已结束',resultTitle:'任务结果 · 完成原因未确认',tone:'unresolved',
  });
});

test('UI neutralizes a COMPLETED record whose persisted completion reason is absent instead of styling it as success',()=>{
  assert.match(js,/completionPresentation\(task\)/);
  assert.match(js,/view\.tone/);
  assert.match(css,/\.mini-badge\.COMPLETED\.unresolved/);
  assert.match(css,/\.phase-badge\.COMPLETED\.unresolved/);
});

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

test('UI never derives GoalState from TaskContract, obligations, assessments, or WorkReceipts',()=>{
  assert.doesNotMatch(js,/taskContract|task_contract|goalState|goal_state|certifiedAssessments|certified_assessments|workReceipts|work_receipts/i);
  assert.doesNotMatch(js,/\bobligations?\b|\bassessments?\b/i);
});
