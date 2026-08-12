import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const TASK_SCHEMA = `
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  instruction TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('READY','RUNNING','WAITING_HUMAN','COMPLETED')),
  ready_reason TEXT CHECK(ready_reason IN ('NEW','HUMAN_REPLY','WAITING_RESOURCE','RETRY_WAIT','SUSPENDED')),
  status_entered_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  completion_reason TEXT CHECK(completion_reason IN ('SUCCESS','CANCELLED')),
  last_stage_result TEXT,
  final_result TEXT,
  executor_key TEXT NOT NULL DEFAULT 'default',
  locked INTEGER NOT NULL DEFAULT 0 CHECK(locked IN (0,1)),
  deleted_at TEXT,
  cancel_requested_at TEXT,
  execution_state_json TEXT,
  analysis_state_json TEXT
`;

const PHASE_SCHEMA = `
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  phase TEXT NOT NULL CHECK(phase IN ('READY','RUNNING','WAITING_HUMAN','COMPLETED')),
  entered_at TEXT NOT NULL,
  exited_at TEXT
`;

const GATEWAY_SCHEMA = `
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK(status IN ('PENDING','RESOLVED','CANCELLED')),
  question TEXT NOT NULL,
  context TEXT,
  target_gap_id TEXT,
  options_json TEXT,
  answer TEXT,
  created_at TEXT NOT NULL,
  resolved_at TEXT
`;

export class TaskDatabase {
  constructor(filename) {
    mkdirSync(dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec('PRAGMA foreign_keys = OFF; PRAGMA journal_mode = WAL;');
    this.migrate();
    this.db.exec('PRAGMA foreign_keys = ON;');
  }

  tableSql(name) {
    return this.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name)?.sql || '';
  }

  columns(name) {
    try { return new Set(this.db.prepare(`PRAGMA table_info(${name})`).all().map(x => x.name)); }
    catch { return new Set(); }
  }

  rebuildTasksIfNeeded() {
    const sql = this.tableSql('tasks');
    if (!sql) {
      this.db.exec(`CREATE TABLE tasks (${TASK_SCHEMA});`);
      return;
    }
    const cols = this.columns('tasks');
    const needs = !sql.includes("'WAITING_RESOURCE'") || !cols.has('completion_reason') || !cols.has('locked') || !cols.has('deleted_at') || !cols.has('cancel_requested_at') || !cols.has('execution_state_json') || !cols.has('analysis_state_json');
    if (!needs) return;
    const expr = name => cols.has(name) ? name : 'NULL';
    const readyExpr = cols.has('ready_reason') ? "CASE WHEN ready_reason='RESOURCE_WAIT' THEN 'WAITING_RESOURCE' WHEN ready_reason IN ('NEW','HUMAN_REPLY','WAITING_RESOURCE','RETRY_WAIT','SUSPENDED') THEN ready_reason ELSE 'NEW' END" : "'NEW'";
    this.db.exec(`
      CREATE TABLE tasks_v4 (${TASK_SCHEMA});
      INSERT INTO tasks_v4(id,title,instruction,status,ready_reason,status_entered_at,created_at,completed_at,completion_reason,last_stage_result,final_result,executor_key,locked,deleted_at,cancel_requested_at,execution_state_json,analysis_state_json)
      SELECT id,title,instruction,status,${readyExpr},status_entered_at,created_at,${expr('completed_at')},${expr('completion_reason')},${expr('last_stage_result')},${expr('final_result')},COALESCE(${expr('executor_key')},'codex'),COALESCE(${expr('locked')},0),${expr('deleted_at')},${expr('cancel_requested_at')},${expr('execution_state_json')},${expr('analysis_state_json')} FROM tasks;
      DROP TABLE tasks;
      ALTER TABLE tasks_v4 RENAME TO tasks;
    `);
  }

  rebuildPhaseIfNeeded() {
    const sql = this.tableSql('task_phase_history');
    if (!sql) return this.db.exec(`CREATE TABLE task_phase_history (${PHASE_SCHEMA});`);
    if (sql.includes("'READY'")) return;
    this.db.exec(`
      CREATE TABLE task_phase_history_v4 (${PHASE_SCHEMA});
      INSERT INTO task_phase_history_v4(id,task_id,phase,entered_at,exited_at)
      SELECT id,task_id,phase,entered_at,exited_at FROM task_phase_history;
      DROP TABLE task_phase_history;
      ALTER TABLE task_phase_history_v4 RENAME TO task_phase_history;
    `);
  }

  rebuildGatewayIfNeeded() {
    const sql = this.tableSql('human_gateways');
    if (!sql) return this.db.exec(`CREATE TABLE human_gateways (${GATEWAY_SCHEMA});`);
    const cols = this.columns('human_gateways');
    if (sql.includes("'CANCELLED'") && cols.has('target_gap_id')) return;
    this.db.exec(`
      CREATE TABLE human_gateways_v4 (${GATEWAY_SCHEMA});
      INSERT INTO human_gateways_v4(id,task_id,status,question,context,target_gap_id,options_json,answer,created_at,resolved_at)
      SELECT id,task_id,status,question,context,${cols.has('target_gap_id') ? 'target_gap_id' : 'NULL'},options_json,answer,created_at,resolved_at FROM human_gateways;
      DROP TABLE human_gateways;
      ALTER TABLE human_gateways_v4 RENAME TO human_gateways;
    `);
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
      INSERT OR IGNORE INTO counters(name, value) VALUES ('task',0),('project',0),('gateway',0);
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
    `);
    this.rebuildTasksIfNeeded();
    this.rebuildPhaseIfNeeded();

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_project_scopes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK(source IN ('registry','temporary')),
        project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
        label TEXT,
        path TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS task_references (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_task_id TEXT NOT NULL REFERENCES tasks(id),
        target_task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        created_at TEXT NOT NULL,
        UNIQUE(source_task_id,target_task_id)
      );
      CREATE TABLE IF NOT EXISTS task_attachments (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        path TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
    this.rebuildGatewayIfNeeded();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS task_progress_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        detail TEXT,
        completed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS maintenance_state (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_phase_task ON task_phase_history(task_id,id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status,status_entered_at DESC);
      CREATE INDEX IF NOT EXISTS idx_tasks_deleted ON tasks(deleted_at);
      CREATE INDEX IF NOT EXISTS idx_scope_task ON task_project_scopes(task_id);
      CREATE INDEX IF NOT EXISTS idx_scope_project ON task_project_scopes(project_id);
      CREATE INDEX IF NOT EXISTS idx_reference_target ON task_references(target_task_id);
      CREATE INDEX IF NOT EXISTS idx_reference_source ON task_references(source_task_id);
      CREATE INDEX IF NOT EXISTS idx_attachment_task ON task_attachments(task_id,created_at);
      CREATE INDEX IF NOT EXISTS idx_gateway_task ON human_gateways(task_id,status);
      CREATE INDEX IF NOT EXISTS idx_progress_task ON task_progress_history(task_id,id);
    `);
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const value = fn();
      this.db.exec('COMMIT');
      return value;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  nextId(counter, prefix) {
    const value = this.transaction(() => {
      const row = this.db.prepare('SELECT value FROM counters WHERE name=?').get(counter);
      const next = Number(row?.value || 0) + 1;
      this.db.prepare('INSERT INTO counters(name,value) VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run(counter,next);
      return next;
    });
    return `${prefix}-${String(value).padStart(4,'0')}`;
  }

  close() { this.db.close(); }
}
