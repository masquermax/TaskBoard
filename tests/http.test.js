import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { MockExecutor } from '../src/extensions/executors/mock/mock-executor.js';
import { createApp } from '../src/server/app.js';
import { APP_VERSION } from '../src/version.js';

async function startTestServer() {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-http-'));
  const db = new JsonTaskDatabase(join(dir, 'db.json'));
  const repo = new JsonTaskRepository(db);
  const service = new TaskService(repo);
  const server = createServer(createApp({ taskService: service, executor: new MockExecutor(), uiRoot: resolve('src/ui') }));
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  const { port } = server.address();
  return { dir, db, server, base: `http://127.0.0.1:${port}` };
}

test('HTTP API serves dashboard, creates task, and applies title/project filters', async () => {
  const x = await startTestServer();
  try {
    const salesPath = join(x.dir, 'sales'); mkdirSync(salesPath);
    const projectResponse = await fetch(`${x.base}/api/projects`, {
      method:'POST', headers:{'content-type':'application/json','x-taskboard-action':'ui'}, body:JSON.stringify({name:'销售系统',path:salesPath})
    });
    assert.equal(projectResponse.status, 201);
    const { project } = await projectResponse.json();

    const taskResponse = await fetch(`${x.base}/api/tasks`, {
      method:'POST', headers:{'content-type':'application/json','x-taskboard-action':'ui'}, body:JSON.stringify({title:'排查订单重复创建',instruction:'定位原因',projectId:project.id})
    });
    assert.equal(taskResponse.status, 201);

    const listResponse = await fetch(`${x.base}/api/tasks?status=READY&title=${encodeURIComponent('订单')}&system=${project.id}`);
    const list = await listResponse.json();
    assert.equal(list.tasks.length, 1);
    assert.equal(list.tasks[0].title, '排查订单重复创建');

    const html = await (await fetch(`${x.base}/`)).text();
    assert.match(html, /任务工作台|TaskBoard/);
  } finally {
    await new Promise(resolveClose => x.server.close(resolveClose));
    x.db.close();
    rmSync(x.dir, { recursive:true, force:true });
  }
});

import { AttachmentStore } from '../src/core/attachment-store.js';

test('HTTP multipart task creation stores and serves attachments', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-http-attachment-'));
  const db = new JsonTaskDatabase(join(dir, 'db.json'));
  const repo = new JsonTaskRepository(db);
  const service = new TaskService(repo, { attachmentStore: new AttachmentStore({ rootDir: join(dir, 'attachments') }) });
  const server = createServer(createApp({ taskService: service, executor: new MockExecutor(), uiRoot: resolve('src/ui') }));
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const form = new FormData();
    form.append('title', '分析附件');
    form.append('instruction', '读取附件并分析');
    form.append('attachments', new Blob(['hello attachment'], { type:'text/plain' }), 'notes.txt');
    const response = await fetch(`${base}/api/tasks`, { method:'POST', headers:{ 'x-taskboard-action':'ui' }, body:form });
    assert.equal(response.status, 201);
    const { task } = await response.json();
    assert.equal(task.attachments.length, 1);
    assert.equal(task.attachments[0].name, 'notes.txt');

    const fileResponse = await fetch(`${base}/api/tasks/${task.id}/attachments/${task.attachments[0].id}`);
    assert.equal(fileResponse.status, 200);
    assert.equal(fileResponse.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(fileResponse.headers.get('content-security-policy'), "default-src 'none'; sandbox");
    assert.equal(fileResponse.headers.get('cross-origin-resource-policy'), 'same-origin');
    assert.equal(await fileResponse.text(), 'hello attachment');
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
    db.close();
    rmSync(dir, { recursive:true, force:true });
  }
});


test('HTTP shutdown endpoint requires the local action header and invokes shutdown callback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-http-shutdown-'));
  const db = new JsonTaskDatabase(join(dir, 'db.json'));
  const repo = new JsonTaskRepository(db);
  const service = new TaskService(repo);
  let shutdownCalled = false;
  const server = createServer(createApp({
    taskService: service,
    executor: new MockExecutor(),
    uiRoot: resolve('src/ui'),
    onShutdown: () => { shutdownCalled = true; },
  }));
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const blocked = await fetch(`${base}/api/system/shutdown`, { method:'POST' });
    assert.equal(blocked.status, 403);
    const allowed = await fetch(`${base}/api/system/shutdown`, {
      method:'POST', headers:{ 'x-taskboard-action':'shutdown' }
    });
    assert.equal(allowed.status, 202);
    await new Promise(resolveWait => setTimeout(resolveWait, 80));
    assert.equal(shutdownCalled, true);
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
    db.close();
    rmSync(dir, { recursive:true, force:true });
  }
});

test('HTTP liveness does not wait for slow executor health', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-http-live-'));
  const db = new JsonTaskDatabase(join(dir, 'db.json'));
  const repo = new JsonTaskRepository(db);
  const service = new TaskService(repo);
  const slowExecutor = {
    async health() {
      await new Promise(resolveWait => setTimeout(resolveWait, 1500));
      return { executor:'slow', available:true };
    },
  };
  const server = createServer(createApp({ taskService: service, executor: slowExecutor, uiRoot: resolve('src/ui') }));
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const started = Date.now();
    const response = await fetch(`${base}/api/live`);
    const elapsed = Date.now() - started;
    assert.equal(response.status, 200);
    const live = await response.json();
    assert.equal(live.ok, true);
    assert.equal(live.app, 'taskboard-codex');
    assert.equal(live.version, APP_VERSION);
    assert.equal(typeof live.pid, 'number');
    assert.ok(elapsed < 500, `liveness took ${elapsed}ms`);
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
    db.close();
    rmSync(dir, { recursive:true, force:true });
  }
});

test('mutating API rejects cross-site style requests without TaskBoard action header', async () => {
  const x = await startTestServer();
  try {
    const blocked = await fetch(`${x.base}/api/projects`, {
      method:'POST', headers:{ 'content-type':'application/json' },
      body:JSON.stringify({ name:'blocked', path:'/tmp/blocked' }),
    });
    assert.equal(blocked.status, 403);
    const allowedPath = join(x.dir, 'allowed'); mkdirSync(allowedPath);
    const allowed = await fetch(`${x.base}/api/projects`, {
      method:'POST', headers:{ 'content-type':'application/json', 'x-taskboard-action':'ui' },
      body:JSON.stringify({ name:'allowed', path:allowedPath }),
    });
    assert.equal(allowed.status, 201);
  } finally {
    await new Promise(resolveClose => x.server.close(resolveClose));
    x.db.close();
    rmSync(x.dir, { recursive:true, force:true });
  }
});

test('runtime endpoint exposes coarse current execution progress without persisting Subagent logs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-http-runtime-'));
  const db = new JsonTaskDatabase(join(dir, 'db.json'));
  const repo = new JsonTaskRepository(db);
  const service = new TaskService(repo);
  const scheduler = {
    getTaskActivity(taskId) {
      return { taskId, state:'running', summary:'Root Agent 正在理解任务', detail:'正在结合附件与 Project Scope。', updatedAt:'2026-08-07T12:00:00.000Z' };
    },
  };
  const server = createServer(createApp({ taskService:service, executor:new MockExecutor(), scheduler, uiRoot:resolve('src/ui') }));
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    const task = service.createTask({ title:'进展测试', instruction:'执行' });
    const response = await fetch(`${base}/api/tasks/${task.id}/runtime`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.runtime.state, 'running');
    assert.match(body.runtime.summary, /Root Agent/);
  } finally {
    await new Promise(resolveClose => server.close(resolveClose));
    db.close();
    rmSync(dir,{recursive:true,force:true});
  }
});

test('capability diagnostics API exposes generic extension snapshot and surface status without a user workflow', async () => {
  const dir=mkdtempSync(join(tmpdir(),'taskboard-http-capability-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));const repo=new JsonTaskRepository(db);const service=new TaskService(repo);
  const capabilityProvider={async discover(){return{extensionId:'demo',discoveryLevel:'partial',execution:{available:true,connected:true,ready:true},provider:{id:'custom'},models:[]};}};
  const surfaceManager={status(){return[{id:'desktop',state:'attached',attachedTargets:1,error:null}];}};
  const server=createServer(createApp({taskService:service,executor:new MockExecutor(),capabilityProvider,surfaceManager,extension:{id:'demo',displayName:'Demo'},uiRoot:resolve('src/ui')}));
  await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));const {port}=server.address();
  try{
    const body=await (await fetch(`http://127.0.0.1:${port}/api/capabilities`)).json();
    assert.equal(body.extension.id,'demo');assert.equal(body.capability.discoveryLevel,'partial');assert.equal(body.surfaces[0].state,'attached');
  }finally{await new Promise(resolveClose=>server.close(resolveClose));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('manual capability refresh preserves and returns the current snapshot on refresh failure', async () => {
  const dir=mkdtempSync(join(tmpdir(),'taskboard-http-capability-refresh-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));const repo=new JsonTaskRepository(db);const service=new TaskService(repo);
  const current={extensionId:'demo',discoveryLevel:'partial',execution:{available:true,connected:true,ready:true},defaults:{model:'model-current'},models:[]};
  const capabilityProvider={snapshot(){return current;},async refresh(){return{refreshed:false,capability:current,error:'model/list timeout'};}};
  const server=createServer(createApp({taskService:service,executor:new MockExecutor(),capabilityProvider,extension:{id:'demo',displayName:'Demo'},uiRoot:resolve('src/ui')}));
  await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));const {port}=server.address();const base=`http://127.0.0.1:${port}`;
  try{
    const response=await fetch(`${base}/api/capabilities/refresh`,{method:'POST',headers:{'x-taskboard-action':'ui'}});
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.refreshed,false);
    assert.equal(body.capability.defaults.model,'model-current');
    assert.match(body.error,/timeout/);
  }finally{await new Promise(resolveClose=>server.close(resolveClose));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('surface hosting is opt-in and can be activated locally without restarting Task Core', async () => {
  const dir=mkdtempSync(join(tmpdir(),'taskboard-http-surface-start-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));const repo=new JsonTaskRepository(db);const service=new TaskService(repo);
  let starts=0,scans=0;
  const surfaceManager={start(){starts+=1;},async scanNow(){scans+=1;return[{id:'desktop',state:'watching'}];},status(){return[];}};
  const server=createServer(createApp({taskService:service,executor:new MockExecutor(),surfaceManager,uiRoot:resolve('src/ui')}));
  await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));const {port}=server.address();const base=`http://127.0.0.1:${port}`;
  try{
    assert.equal(starts,0);
    const blocked=await fetch(`${base}/api/surfaces/start`,{method:'POST'});assert.equal(blocked.status,403);
    const allowed=await fetch(`${base}/api/surfaces/start`,{method:'POST',headers:{'x-taskboard-action':'ui'}});assert.equal(allowed.status,200);
    assert.equal(starts,1);assert.equal(scans,1);
  }finally{await new Promise(resolveClose=>server.close(resolveClose));db.close();rmSync(dir,{recursive:true,force:true});}
});


test('static TaskBoard UI no longer needs Codex-specific cross-origin iframe headers', async () => {
  const x = await startTestServer();
  try {
    const browser = await fetch(`${x.base}/`);
    assert.equal(browser.status, 200);
    assert.equal(browser.headers.get('cross-origin-embedder-policy'), null);
    assert.equal(browser.headers.get('cross-origin-resource-policy'), null);

    const legacyHostQuery = await fetch(`${x.base}/?host=codex`);
    assert.equal(legacyHostQuery.status, 200);
    assert.equal(legacyHostQuery.headers.get('cross-origin-embedder-policy'), null);
    assert.equal(legacyHostQuery.headers.get('cross-origin-resource-policy'), null);
  } finally {
    await new Promise(resolveClose => x.server.close(resolveClose));
    x.db.close();
    rmSync(x.dir, { recursive:true, force:true });
  }
});

test('simple settings API exposes only task concurrency and per-Root maximum Subagents plus non-editable capability/effective facts', async () => {
  const dir=mkdtempSync(join(tmpdir(),'taskboard-http-settings-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));const repo=new JsonTaskRepository(db);const service=new TaskService(repo);
  let current={taskConcurrency:2,taskMaxSubagents:3};
  const settingsStore={get(){return{...current};}};
  const runtimeSettingsState=()=>({configured:{...current},limits:{taskConcurrency:null,taskMaxSubagents:null},effective:{...current}});
  const applyRuntimeSettings=next=>{current={...current,...next};return runtimeSettingsState();};
  const server=createServer(createApp({taskService:service,executor:new MockExecutor(),settingsStore,runtimeSettingsState,applyRuntimeSettings,uiRoot:resolve('src/ui')}));
  await new Promise(resolveReady=>server.listen(0,'127.0.0.1',resolveReady));const {port}=server.address();const base=`http://127.0.0.1:${port}`;
  try{
    let response=await fetch(`${base}/api/settings`);assert.equal(response.status,200);let body=await response.json();assert.deepEqual(body.settings,{taskConcurrency:2,taskMaxSubagents:3});assert.deepEqual(body.limits,{taskConcurrency:null,taskMaxSubagents:null});
    response=await fetch(`${base}/api/settings`,{method:'PUT',headers:{'content-type':'application/json','x-taskboard-action':'ui'},body:JSON.stringify({taskConcurrency:5,taskMaxSubagents:4})});
    assert.equal(response.status,200);body=await response.json();assert.deepEqual(body.settings,{taskConcurrency:5,taskMaxSubagents:4});assert.deepEqual(body.effective,{taskConcurrency:5,taskMaxSubagents:4});
    response=await fetch(`${base}/api/settings`);assert.deepEqual((await response.json()).settings,{taskConcurrency:5,taskMaxSubagents:4});
  }finally{await new Promise(resolveClose=>server.close(resolveClose));db.close();rmSync(dir,{recursive:true,force:true});}
});
