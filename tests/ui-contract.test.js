import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html=readFileSync(join(process.cwd(),'src/ui/index.html'),'utf8');
const js=readFileSync(join(process.cwd(),'src/ui/app.js'),'utf8');
const connectionJs=readFileSync(join(process.cwd(),'src/ui/connection-settings.js'),'utf8');
const css=readFileSync(join(process.cwd(),'src/ui/app.css'),'utf8');
const retry=readFileSync(join(process.cwd(),'src/core/retry-policy.js'),'utf8');

test('new-task Close/Cancel are non-submit buttons and dialog form disables native validation trap',()=>{
  assert.match(html,/<form[^>]+id="task-form"[^>]+novalidate/i);
  assert.match(html,/id="task-dialog-close"[^>]+type="button"|type="button"[^>]+id="task-dialog-close"/i);
  assert.match(html,/id="task-dialog-cancel"[^>]+type="button"|type="button"[^>]+id="task-dialog-cancel"/i);
  assert.match(js,/task-dialog-close[^\n]+\.close\(\)/);
  assert.match(js,/task-dialog-cancel[^\n]+\.close\(\)/);
  assert.match(js,/create-task-submit[\s\S]{0,500}if\(!title\|\|!instruction\)return toast\('请填写任务标题和任务内容'\)/);
});

test('progress UI separates active judgment, execution work, completed work, and confirmed knowledge while confirmed progress defaults folded',()=>{
  assert.match(html,/id="history-progress"[^>]*class="[^"]*hidden/i);
  assert.match(html,/已确认进展/);
  assert.match(html,/已经进入当前认知的结论/);
  assert.match(js,/workOwnerLabel/);
  assert.match(js,/Root/);
  assert.match(js,/Subagent/);
  assert.match(js,/work-owner/);
  assert.match(js,/runtimeWork/);
  assert.match(js,/正在判断/);
  assert.match(js,/当前工作/);
  assert.match(js,/已完成工作/);
  assert.match(js,/当前还没有已确认的进展/);
});

test('suspended retry copy explicitly tells the user what to do and uses a retry icon action',()=>{
  assert.match(retry,/请稍后点击右上角 ↻ 重试按钮重新尝试/);
  assert.match(js,/data-retry-work/);
  assert.match(js,/重新进入尝试流程，将从第 1\/5 次开始/);
});

test('capability discovery stays read-only while Executor-owned connection settings expose a separate secret-safe provider surface',()=>{
  assert.match(js,/h\.displayName\|\|h\.executor/);
  assert.match(js,/OpenAI API/);
  assert.match(js,/h\.providerId/);
  assert.doesNotMatch(js,/API Key|Base URL|connection-mode|connection-api-key/i,'capability discovery UI must not become provider configuration');
  assert.match(html,/id="connection-settings-section"/);
  assert.match(html,/id="connection-mode"/);
  assert.match(html,/id="connection-api-key"[^>]+type="password"|type="password"[^>]+id="connection-api-key"/i);
  assert.match(connectionJs,/\/api\/executor\/connection/);
  assert.match(connectionJs,/apiKeyConfigured/);
  assert.doesNotMatch(connectionJs,/connection\.apiKey\b/,'stored API key must never be read back into the UI');
  assert.doesNotMatch(html,/登录 ChatGPT|连接 ChatGPT|切换 Provider/i);
  assert.doesNotMatch(html,/model[^>]*select|reasoning[^>]*select/i);
  assert.match(html,/id="executor-model-refresh"/);
  assert.match(html,/data-refresh-state="refreshing"[^>]+aria-busy="true"/);
  assert.match(js,/刷新失败，已保留当前模型/);
});


test('AI model refresh button exposes runtime-owned success/startup-failure/manual-failure/busy states',()=>{
  assert.match(js,/function executorRefreshPresentation/);
  assert.match(js,/state==='success'/);
  assert.match(js,/state==='startup_failed'/);
  assert.match(js,/state==='manual_failed'/);
  assert.match(js,/state==='refreshing'/);
  assert.match(js,/dataset\.refreshState=view\.state/);
  assert.match(css,/data-refresh-state="success"/);
  assert.match(css,/data-refresh-state="startup-failed"/);
  assert.match(css,/data-refresh-state="manual-failed"/);
  assert.match(css,/data-refresh-state="refreshing"/);
  assert.match(js,/首次自动刷新失败，已保留当前模型记录/);
  assert.match(js,/手动刷新失败，已保留当前模型记录/);
});


test('AI model refresh presentation maps runtime state to the four visible button states',()=>{
  const normalizedJs=js.replace(/\r\n/g,'\n');
  const start=normalizedJs.indexOf('function executorRefreshPresentation(');
  const end=normalizedJs.indexOf('\nfunction applyExecutorRefreshPresentation',start);
  assert.ok(start>=0&&end>start,'executorRefreshPresentation source must be locatable');
  const source=normalizedJs.slice(start,end);
  const present=Function(`${source}; return executorRefreshPresentation;`)();
  assert.equal(present({modelRefresh:{state:'refreshing',source:'startup'}}).state,'refreshing');
  assert.equal(present({model:'m',modelRefresh:{state:'success',lastRefresh:{ok:true,at:'now'}}}).state,'success');
  assert.equal(present({model:'m',modelRefresh:{state:'startup_failed',lastRefresh:{ok:false,source:'startup',error:'timeout'}}}).state,'startup-failed');
  assert.equal(present({model:'m',modelRefresh:{state:'manual_failed',lastRefresh:{ok:false,source:'manual',error:'timeout'}}}).state,'manual-failed');
  assert.equal(present({}).state,'idle');
});

test('Codex embedded UI reports readiness to the host only after initial TaskBoard bootstrap succeeds',()=>{
  assert.match(js,/embeddedHost&&window\.parent&&window\.parent!==window/);
  assert.match(js,/postMessage\(\{type:'taskboard:ready',host:embeddedHost\},'\*'\)/);
});


test('simple configuration keeps runtime concurrency controls limited to task concurrency and per-Root maximum Subagents while connection settings remain a separate section',()=>{
  assert.match(html,/id="simple-config-link"[^>]*>简易配置</);
  assert.match(html,/id="connection-settings-section"/);
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
  assert.match(js,/function taskCardTimes\(task\)/);
  assert.match(js,/task\.status!=='COMPLETED'/);
  assert.match(js,/创建 · \$\{formatPhaseTime\(task\.created_at\)\}/);
  assert.match(js,/\$\{displayTaskBadge\(task\)\} · \$\{formatPhaseTime\(task\.status_entered_at\)\}/);
});

test('runtimeWork keeps Root or Validator visible beside Work Units and separates completed work',()=>{
  const normalizedJs=js.replace(/\r\n/g,'\n');
  const start=normalizedJs.indexOf('function runtimeWork(');
  const end=normalizedJs.indexOf('\nfunction workOwnerLabel',start);
  assert.ok(start>=0&&end>start,'runtimeWork source must be locatable');
  const source=normalizedJs.slice(start,end);
  const runtimeWork=Function(`${source}; return runtimeWork;`)();
  const result=runtimeWork({current:{
    actor:{id:'validator',title:'Validator 认证',status:'RUNNING',owner:'validator'},
    stage:{id:'stage-2',workUnits:[
      {id:'running',title:'核对 OA 项目',status:'RUNNING'},
      {id:'done-now',title:'附件分析',status:'COMPLETED'},
    ]},
    completedWorkUnits:[{id:'done-old',stageId:'stage-1',title:'前一阶段工作',status:'COMPLETED'}],
  }});
  assert.equal(result.actor.length,1);
  assert.equal(result.actor[0].owner,'validator');
  assert.deepEqual(result.active.map(x=>x.id),['running']);
  assert.deepEqual(result.completed.map(x=>x.id),['done-old','done-now']);
  assert.equal(result.workUnits.length,3);
});

test('current UI uses one project and Subagent-settings vocabulary without legacy system/thread labels',()=>{
  const currentUi=`${html}\n${js}\n${connectionJs}\n${css}`;
  assert.match(html,/项目筛选/);
  assert.match(html,/按任务标题模糊搜索/);
  assert.match(html,/任务标题/);
  assert.match(html,/项目范围/);
  assert.match(html,/未登记项目/);
  assert.match(html,/临时项目范围/);
  assert.match(html,/id="task-temp-project-path"/);
  assert.match(html,/每任务 Subagent 上限/);
  assert.doesNotMatch(currentUi,/系统筛选|列表外|任务最大线程数|system-filter|system-chip|task-temp-path|\bTitle\b|Project Scope|PROJECT REGISTRY|NEW TASK|SIMPLE SETTINGS|TASK ACTION|HUMAN GATEWAY/);
  assert.match(js,/项目访问：\$\{project\} · 网络：/,'Subagent capability grants must be visible on Work Unit cards');
  assert.match(css,/\.work-capabilities/);
});
