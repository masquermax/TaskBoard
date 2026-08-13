import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const html=readFileSync(resolve('src/ui/index.html'),'utf8');
const js=readFileSync(resolve('src/ui/app.js'),'utf8');
const css=readFileSync(resolve('src/ui/app.css'),'utf8');

test('new-task dialog uses task/project terminology and canonical current labels',()=>{
  assert.match(html,/新建任务/);
  assert.match(html,/项目/);
  assert.match(html,/任务标题/);
  assert.doesNotMatch(html,/System Filter|系统筛选|Root Agent|Execution Adapter|Tool Executor/);
});

test('project filter and project list use the same canonical project term',()=>{
  assert.match(html,/项目筛选/);
  assert.match(html,/项目列表/);
  assert.doesNotMatch(html,/系统筛选|系统列表/);
});

test('task detail separates current execution from confirmed knowledge',()=>{
  assert.match(html,/当前执行/);
  assert.match(html,/已确认进展/);
  assert.match(html,/当前结果/);
  assert.doesNotMatch(html,/Root Agent|Execution Adapter|Tool Executor/);
});

test('new-task project selector is a normal select and allows unassociated task',()=>{
  assert.match(html,/id="task-project"/);
  assert.match(js,/value="">不关联项目/);
  assert.doesNotMatch(html,/id="task-project"[^>]*multiple/);
});

test('project manager keeps path and display name as separate user concepts',()=>{
  assert.match(html,/项目名称/);
  assert.match(html,/项目路径/);
  assert.match(js,/project\.name/);
  assert.match(js,/project\.path/);
});

test('task cards and details avoid executor-internal vocabulary',()=>{
  assert.doesNotMatch(html,/Execution Adapter|Tool Executor|Root Agent|SystemFilter/);
  assert.doesNotMatch(js,/Execution Adapter|Tool Executor|Root Agent|SystemFilter/);
});

test('runtime UI uses Root/Subagent/Validator owner vocabulary consistently',()=>{
  assert.match(js,/Root/);
  assert.match(js,/Subagent/);
  assert.match(js,/Validator/);
  assert.doesNotMatch(js,/Lead Agent|Worker Agent|Root Agent/);
});

test('project filter values are project ids rather than a second system domain',()=>{
  assert.match(html,/id="project-filter"/);
  assert.match(js,/state\.project/);
  assert.doesNotMatch(js,/systemFilter|system-filter/);
});

test('new task instruction is the canonical business request field',()=>{
  assert.match(html,/id="task-instruction"/);
  assert.match(js,/instruction/);
  assert.doesNotMatch(html,/任务描述|任务需求/);
});

test('settings expose only user-level concurrency controls and capability facts',()=>{
  assert.match(html,/任务并发数/);
  assert.match(html,/id="setting-task-concurrency"/);
  assert.match(html,/每任务 Subagent 上限/);
  assert.match(html,/id="setting-task-max-subagents"/);
  const settings=html.slice(html.indexOf('id="settings-dialog"'),html.indexOf('</dialog>',html.indexOf('id="settings-dialog"')));
  assert.match(settings,/value="5">5</);
  assert.match(settings,/每个 Root 最多同时拥有的 Subagent 数/);
  assert.match(settings,/AI 并发能力：未报告明确上限/);
  assert.match(js,/当前 AI 上限为/);
  assert.doesNotMatch(settings,/公平配额|全局资源池|为当前任务选择 Agent|手工分配 Agent/i);
});

test('dashboard refresh preserves an active new-task project draft instead of resetting it to unassociated',()=>{
  assert.match(js,/const draftProjectId=taskProject\?\.value\|\|''/);
  assert.match(js,/if\(draftProjectId&&state\.projects\.some\(p=>p\.id===draftProjectId\)\)taskProject\.value=draftProjectId/);
});


test('user-facing history is driven by valuable progress nodes and does not expose the raw last-stage scratch result section',()=>{
  assert.doesNotMatch(html,/最近阶段结果|id="detail-stage-section"/);
  assert.doesNotMatch(js,/detail-stage-result|detail-stage-section/);
});

test('new-task project selection survives the actual renderProjectEnums rebuild logic',()=>{
  const normalizedJs=js.replace(/\r\n/g,'\n');
  const start=normalizedJs.indexOf('function renderProjectEnums(){');
  const end=normalizedJs.indexOf('\n\nasync function refreshTasks',start);
  assert.ok(start>=0&&end>start,'renderProjectEnums source must be locatable');
  const source=normalizedJs.slice(start,end);
  const taskProject={value:'P-0001',_html:'',set innerHTML(value){this._html=value;this.value='';},get innerHTML(){return this._html;}};
  const elements={
    'task-project':taskProject,
    'project-mini-list':{innerHTML:''},
    'project-filter':{innerHTML:'',value:'all'},
    'project-list':{innerHTML:''},
  };
  const state={projects:[{id:'P-0001',name:'OA',path:'D:/OA'}],project:'all'};
  const $=id=>elements[id];
  const escapeHtml=value=>String(value??'');
  const document={querySelectorAll:()=>[]};
  // Execute the production function against a minimal select mock whose innerHTML setter
  // reproduces the browser behavior that caused the original 4-second refresh reset.
  const renderProjectEnums=Function('$','state','escapeHtml','document',`${source}; return renderProjectEnums;`)($,state,escapeHtml,document);
  renderProjectEnums();
  assert.equal(taskProject.value,'P-0001');
});

test('current-progress header is derived from Work Unit state while Root or Validator activity may be rendered beside it',()=>{
  assert.match(js,/runtime-overview'\)\.textContent=work\.workUnits\.length\?/);
  assert.match(js,/work\.actor\.length/);
});

test('completed-list cards add creation time while preserving the current completed-phase time',()=>{
  assert.match(js,/创建：\$\{escapeHtml\(formatTaskTime\(t\.created_at\)\)\}/);
  assert.match(js,/完成：\$\{escapeHtml\(formatTaskTime\(t\.status_entered_at\|\|t\.updated_at\)\)\}/);
});

test('runtimeWork keeps Root or Validator visible beside Work Units and separates completed work',()=>{
  assert.match(js,/const actor=snap\?\.actor/);
  assert.match(js,/const completed=\(snap\?\.completedWorkUnits\|\|\[\]\)/);
  assert.match(js,/return\{actor:actor\?\[\{\.\.\.actor\}\]:\[\],workUnits,completedWorkUnits:completed\}/);
});

test('current UI uses one project and Subagent-settings vocabulary without legacy system/thread labels',()=>{
  const visible=`${html}\n${js}`;
  assert.doesNotMatch(visible,/系统筛选|系统列表|Root Agent|Execution Adapter|Tool Executor|Task maximum threads|最大线程|workerConcurrency|taskMaxThreads/);
});
