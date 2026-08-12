import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../src/server/bootstrap.js';
import { createApp } from '../src/server/app.js';

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json();
  assert.ok(response.ok, `${response.status} ${JSON.stringify(body)}`);
  return body;
}

test('full task flow: project -> attachment task -> Human Gateway -> completion -> search -> reference', async () => {
  const rootDir = mkdtempSync(join(tmpdir(), 'taskboard-full-flow-'));
  const projectDir = join(rootDir, 'oa-project');
  mkdirSync(projectDir, { recursive:true });
  const runtime = bootstrap({ rootDir, storage:'json', executorName:'mock', startScheduler:false });
  const server = createServer(createApp({
    taskService: runtime.taskService,
    executor: runtime.executor,
    scheduler: runtime.scheduler,
    uiRoot: resolve('src/ui'),
  }));
  await new Promise(resolveReady => server.listen(0, '127.0.0.1', resolveReady));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  try {
    const live = await requestJson(`${base}/api/live`);
    assert.equal(live.app, 'taskboard-codex');

    const { project } = await requestJson(`${base}/api/projects`, {
      method:'POST', headers:{ 'content-type':'application/json', 'x-taskboard-action':'ui' },
      body:JSON.stringify({ name:'OA', path:projectDir }),
    });

    const form = new FormData();
    form.append('title', '做一个 OA 系统');
    form.append('instruction', '你帮我做了吧');
    form.append('projectId', project.id);
    form.append('attachments', new Blob(['OA background material'], { type:'text/plain' }), '背景资料.txt');
    const { task: created } = await requestJson(`${base}/api/tasks`, { method:'POST', headers:{ 'x-taskboard-action':'ui' }, body:form });
    assert.equal(created.status, 'READY');
    assert.equal(created.ready_reason, 'NEW');
    assert.equal(created.executor_key, 'mock');
    assert.equal(created.attachments.length, 1);
    assert.equal(created.projectScopes[0].projectId, project.id);

    await runtime.scheduler.tick();
    const waiting = (await requestJson(`${base}/api/tasks/${created.id}`)).task;
    assert.equal(waiting.status, 'WAITING_HUMAN');
    assert.ok(waiting.pendingGateway);
    const phasesBefore = (await requestJson(`${base}/api/tasks/${created.id}/phases`)).phases;
    assert.deepEqual(phasesBefore.map(x => x.phase), ['READY', 'RUNNING', 'WAITING_HUMAN']);

    const waitingSearch = await requestJson(`${base}/api/tasks?status=WAITING_HUMAN&title=OA&system=${project.id}`);
    assert.equal(waitingSearch.tasks.length, 1);
    assert.equal(waitingSearch.tasks[0].id, created.id);

    const attachmentResponse = await fetch(`${base}/api/tasks/${created.id}/attachments/${created.attachments[0].id}`);
    assert.equal(attachmentResponse.status, 200);
    assert.equal(await attachmentResponse.text(), 'OA background material');

    await requestJson(`${base}/api/tasks/${created.id}/human-gateway`, {
      method:'POST', headers:{ 'content-type':'application/json', 'x-taskboard-action':'ui' }, body:JSON.stringify({ answer:'基础办公' }),
    });
    const replied = (await requestJson(`${base}/api/tasks/${created.id}`)).task;
    assert.equal(replied.status, 'READY');
    assert.equal(replied.ready_reason, 'HUMAN_REPLY');
    await runtime.scheduler.tick();
    const completed = (await requestJson(`${base}/api/tasks/${created.id}`)).task;
    assert.equal(completed.status, 'COMPLETED');
    assert.match(completed.final_result, /已完成/);

    const completedSearch = await requestJson(`${base}/api/tasks?status=COMPLETED&title=OA&system=${project.id}`);
    assert.equal(completedSearch.tasks.length, 1);

    const { task: followup } = await requestJson(`${base}/api/tasks`, {
      method:'POST', headers:{ 'content-type':'application/json', 'x-taskboard-action':'ui' },
      body:JSON.stringify({ title:'基于已完成结果继续', instruction:'整理下一步计划', referenceTaskIds:[created.id] }),
    });
    assert.equal(followup.references.length, 1);
    assert.equal(followup.references[0].source_task_id, created.id);
    const sourceBefore = completed.final_result;
    await runtime.scheduler.tick();
    assert.equal(runtime.taskService.getTask(followup.id).status, 'COMPLETED');
    assert.equal(runtime.taskService.getTask(created.id).final_result, sourceBefore);

    const dashboard = await requestJson(`${base}/api/dashboard`);
    assert.equal(dashboard.counts.WAITING_HUMAN, 0);
    assert.equal(dashboard.counts.COMPLETED, 2);
  } finally {
    runtime.scheduler.stop();
    runtime.executor.close?.();
    await new Promise(resolveClose => server.close(resolveClose));
    runtime.database.close();
    rmSync(rootDir, { recursive:true, force:true });
  }
});
