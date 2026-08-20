import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { TaskStatus } from '../src/core/types.js';
import { Scheduler } from '../src/core/scheduler.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { asRuntimeExecutor } from './helpers/runtime-executor.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { MockExecutor } from '../src/extensions/executors/mock/mock-executor.js';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-test-'));
  const db = new JsonTaskDatabase(join(dir, 'db.json'));
  const repo = new JsonTaskRepository(db);
  const service = new TaskService(repo);
  const extensionExecutor = new MockExecutor(); const executor=asRuntimeExecutor(extensionExecutor); const router = new ModelRouter();
  const subagentRuntime = new SubagentRuntime({ executor, modelRouter:router });
  const rootRuntime = new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(), executor, modelRouter:router, subagentRuntime });
  const scheduler = new Scheduler({ repository:repo, taskService:service, rootRuntime, intervalMs:999999 });
  return { dir, db, repo, service, scheduler, close(){ scheduler.stop(); db.close(); rmSync(dir,{recursive:true,force:true}); } };
}

test('temporary project scope does not enter Project List', () => {
  const x = setup();
  try {
    const tempPath = join(x.dir, 'example'); mkdirSync(tempPath);
    const task = x.service.createTask({ title:'临时任务', instruction:'处理临时项目范围', temporaryProjectPath:tempPath });
    assert.equal(x.service.listProjects().length, 0);
    assert.equal(task.projectScopes[0].source, 'temporary');
    assert.equal(task.projectScopes[0].path, tempPath);
  } finally { x.close(); }
});

test('title fuzzy search is scoped by status and project filter', () => {
  const x = setup();
  try {
    const salesPath = join(x.dir, 'sales'); const toolPath = join(x.dir, 'tool'); mkdirSync(salesPath); mkdirSync(toolPath);
    const p = x.service.createProject({ name:'销售系统', path:salesPath });
    x.service.createTask({ title:'排查订单重复创建', instruction:'A', projectId:p.id });
    x.service.createTask({ title:'订单临时脚本', instruction:'B', temporaryProjectPath:toolPath });
    const registered = x.service.listTasks({ status:TaskStatus.READY, title:'订单', project:p.id });
    const unregistered = x.service.listTasks({ status:TaskStatus.READY, title:'订单', project:'unregistered' });
    assert.equal(registered.length, 1);
    assert.equal(registered[0].title, '排查订单重复创建');
    assert.equal(unregistered.length, 1);
    assert.equal(unregistered[0].title, '订单临时脚本');
  } finally { x.close(); }
});

test('phase history records every Scheduler-owned entry while UI can read current status_entered_at', async () => {
  const x = setup();
  try {
    const task = x.scheduler.createTask({ title:'做一个 OA 系统', instruction:'你帮我做了吧' });
    await x.scheduler.tick();
    const waiting = x.service.getTask(task.id);
    assert.equal(waiting.status, TaskStatus.WAITING_HUMAN);
    x.scheduler.answerHumanGateway(task.id, '基础办公');
    const ready = x.service.getTask(task.id);
    assert.equal(ready.status, TaskStatus.READY);
    assert.equal(ready.ready_reason, 'HUMAN_REPLY');
    assert.ok(ready.status_entered_at);
    const phases = x.service.phaseHistory(task.id);
    assert.deepEqual(phases.map(p => p.phase), ['READY','RUNNING','WAITING_HUMAN','READY']);
    assert.ok(phases[0].exited_at);
    assert.ok(phases[1].exited_at);
    assert.ok(phases[2].exited_at);
    assert.equal(phases[3].exited_at, null);
  } finally { x.close(); }
});

test('completed task can be referenced without reverse mutation', async () => {
  const x = setup();
  try {
    const source = x.scheduler.createTask({ title:'需求分析', instruction:'整理明确需求' });
    await x.scheduler.tick();
    const sourceDone = x.service.getTask(source.id);
    assert.equal(sourceDone.status, TaskStatus.COMPLETED);
    const sourceBefore = sourceDone.final_result;
    const target = x.scheduler.createTask({ title:'开发', instruction:'基于需求开发', referenceTaskIds:[source.id] });
    assert.equal(target.references[0].final_result, sourceBefore);
    await x.scheduler.tick();
    assert.equal(x.service.getTask(target.id).status, TaskStatus.COMPLETED);
    assert.equal(x.service.getTask(source.id).final_result, sourceBefore);
  } finally { x.close(); }
});

import { existsSync, readFileSync } from 'node:fs';
import { AttachmentStore } from '../src/core/attachment-store.js';

test('task attachments are durable task inputs and do not enter Project List', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-attachment-test-'));
  const db = new JsonTaskDatabase(join(dir, 'db.json'));
  const repo = new JsonTaskRepository(db);
  const attachmentStore = new AttachmentStore({ rootDir: join(dir, 'attachments') });
  const service = new TaskService(repo, { attachmentStore });
  try {
    const task = service.createTask({
      title:'分析附件需求', instruction:'根据附件整理需求',
      attachments:[{ name:'需求说明.txt', type:'text/plain', data:Buffer.from('附件里的需求内容') }],
    });
    assert.equal(task.attachments.length, 1);
    assert.equal(task.attachments[0].name, '需求说明.txt');
    assert.equal('path' in task.attachments[0], false, 'public Task attachment metadata must not expose a local filesystem path');
    const internalTask=repo.getTask(task.id);
    assert.ok(existsSync(internalTask.attachments[0].path));
    assert.equal(readFileSync(internalTask.attachments[0].path, 'utf8'), '附件里的需求内容');
    assert.equal(service.listProjects().length, 0);

    db.close();
    const reopenedDb = new JsonTaskDatabase(join(dir, 'db.json'));
    const reopened = new TaskService(new JsonTaskRepository(reopenedDb), { attachmentStore });
    assert.equal(reopened.getTask(task.id).attachments[0].name, '需求说明.txt');
    reopenedDb.close();
  } finally {
    rmSync(dir, { recursive:true, force:true });
  }
});

test('corrupt JSON persistence fails loudly instead of silently showing an empty board', () => {
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-corrupt-json-'));
  const file = join(dir, 'db.json');
  try {
    writeFileSync(file, '{not valid json', 'utf8');
    assert.throws(() => new JsonTaskDatabase(file), /TASKBOARD_DATA_CORRUPT/);
  } finally { rmSync(dir, { recursive:true, force:true }); }
});

test('project and temporary project scopes reject missing filesystem paths before execution starts', () => {
  const x = setup();
  try {
    const missing = join(x.dir, 'does-not-exist');
    assert.throws(() => x.service.createProject({ name:'不存在', path:missing }), /PROJECT_PATH_NOT_FOUND/);
    assert.throws(() => x.service.createTask({ title:'临时', instruction:'执行', temporaryProjectPath:missing }), /PROJECT_PATH_NOT_FOUND/);
  } finally { x.close(); }
});
