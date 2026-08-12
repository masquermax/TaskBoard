import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let DatabaseSync = null;
try { ({ DatabaseSync } = await import('node:sqlite')); } catch { /* older Node runtime */ }

if (DatabaseSync) {
  test('SQLite v0.2 task schema migrates to READY-capable v0.4 schema without losing task facts', async () => {
    const { TaskDatabase } = await import('../src/core/database.js');
    const dir = mkdtempSync(join(tmpdir(), 'taskboard-sqlite-migrate-'));
    const file = join(dir, 'old.db');
    const legacy = new DatabaseSync(file);
    legacy.exec(`
      CREATE TABLE counters(name TEXT PRIMARY KEY,value INTEGER NOT NULL);
      INSERT INTO counters VALUES('task',1); INSERT INTO counters VALUES('project',0); INSERT INTO counters VALUES('gateway',0);
      CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT NOT NULL UNIQUE,path TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL);
      CREATE TABLE tasks(id TEXT PRIMARY KEY,title TEXT NOT NULL,instruction TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('RUNNING','WAITING_HUMAN','COMPLETED')),status_entered_at TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT,last_stage_result TEXT,final_result TEXT,executor_key TEXT NOT NULL DEFAULT 'codex');
      CREATE TABLE task_phase_history(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,phase TEXT NOT NULL CHECK(phase IN ('RUNNING','WAITING_HUMAN','COMPLETED')),entered_at TEXT NOT NULL,exited_at TEXT);
      INSERT INTO tasks VALUES('T-0001','旧任务','保持事实','RUNNING','2026-08-07T00:00:00Z','2026-08-07T00:00:00Z',NULL,'阶段A',NULL,'codex');
      INSERT INTO task_phase_history(task_id,phase,entered_at) VALUES('T-0001','RUNNING','2026-08-07T00:00:00Z');
    `);
    legacy.close();
    const migrated = new TaskDatabase(file);
    try {
      const row = migrated.db.prepare('SELECT * FROM tasks WHERE id=?').get('T-0001');
      assert.equal(row.title, '旧任务');
      assert.equal(row.last_stage_result, '阶段A');
      assert.equal(row.ready_reason, 'NEW');
      const sql = migrated.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='tasks'").get().sql;
      assert.match(sql, /READY/);
    } finally { migrated.close(); rmSync(dir,{recursive:true,force:true}); }
  });
}
