import { TaskStatus, ReadyReason, CompletionReason, ProjectFilter } from './types.js';
import { migrateExecutionState, migrateReadyReason } from './runtime-state-migration.js';

function parseJson(text, fallback = null) {
  if (!text) return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

export class TaskRepository {
  constructor(taskDatabase) {
    this.store = taskDatabase;
    this.db = taskDatabase.db;
  }

  now() { return new Date().toISOString(); }

  createProject({ name, path }) {
    const id = this.store.nextId('project','P');
    const createdAt = this.now();
    this.db.prepare('INSERT INTO projects(id,name,path,created_at) VALUES (?,?,?,?)').run(id,name.trim(),path.trim(),createdAt);
    return this.getProject(id);
  }
  listProjects() { return this.db.prepare('SELECT * FROM projects ORDER BY name COLLATE NOCASE').all(); }
  getProject(id) { return this.db.prepare('SELECT * FROM projects WHERE id=?').get(id) || null; }
  deleteProject(id) { return this.db.prepare('DELETE FROM projects WHERE id=?').run(id).changes > 0; }

  createTask({ title, instruction, projectId = null, temporaryProjectPath = null, referenceTaskIds = [], executorKey = 'default', attachments = [] }) {
    const id = this.store.nextId('task','T');
    const now = this.now();
    this.store.transaction(() => {
      this.db.prepare(`INSERT INTO tasks(id,title,instruction,status,ready_reason,status_entered_at,created_at,executor_key,locked)
        VALUES (?,?,?,?,?,?,?,?,0)`).run(id,title.trim(),instruction.trim(),TaskStatus.READY,ReadyReason.NEW,now,now,executorKey);
      this.db.prepare('INSERT INTO task_phase_history(task_id,phase,entered_at) VALUES (?,?,?)').run(id,TaskStatus.READY,now);
      if (projectId) {
        const project = this.getProject(projectId);
        if (!project) throw new Error('PROJECT_NOT_FOUND');
        this.db.prepare(`INSERT INTO task_project_scopes(task_id,source,project_id,label,path,created_at) VALUES (?,?,?,?,?,?)`)
          .run(id,'registry',project.id,project.name,project.path,now);
      }
      if (temporaryProjectPath?.trim()) {
        this.db.prepare(`INSERT INTO task_project_scopes(task_id,source,project_id,label,path,created_at) VALUES (?,?,?,?,?,?)`)
          .run(id,'temporary',null,'临时项目范围',temporaryProjectPath.trim(),now);
      }
      for (const sourceId of referenceTaskIds) {
        const source = this.db.prepare('SELECT id,status,deleted_at FROM tasks WHERE id=?').get(sourceId);
        if (!source || source.status !== TaskStatus.COMPLETED || source.deleted_at) throw new Error('REFERENCE_MUST_BE_COMPLETED');
        this.db.prepare('INSERT OR IGNORE INTO task_references(source_task_id,target_task_id,created_at) VALUES (?,?,?)').run(sourceId,id,now);
      }
      for (const a of attachments) {
        this.db.prepare(`INSERT INTO task_attachments(id,task_id,name,mime_type,size_bytes,path,created_at) VALUES (?,?,?,?,?,?,?)`)
          .run(a.id,id,a.name,a.mimeType,a.size,a.path,a.createdAt || now);
      }
    });
    return this.getTask(id);
  }

  listTasks({ status = TaskStatus.READY, title = '', project = ProjectFilter.ALL } = {}) {
    const clauses = ['t.status=?','t.deleted_at IS NULL'];
    const params = [status];
    if (title.trim()) { clauses.push('LOWER(t.title) LIKE ?'); params.push(`%${title.trim().toLowerCase()}%`); }
    if (project === ProjectFilter.UNREGISTERED) {
      clauses.push(`NOT EXISTS (SELECT 1 FROM task_project_scopes sr WHERE sr.task_id=t.id AND sr.source='registry' AND sr.project_id IS NOT NULL)`);
    } else if (project && project !== ProjectFilter.ALL) {
      clauses.push(`EXISTS (SELECT 1 FROM task_project_scopes sp WHERE sp.task_id=t.id AND sp.source='registry' AND sp.project_id=?)`);
      params.push(project);
    }
    const order = status === TaskStatus.COMPLETED
      ? 't.locked DESC, t.status_entered_at DESC, t.created_at DESC'
      : 't.status_entered_at DESC, t.created_at DESC';
    return this.db.prepare(`SELECT t.* FROM tasks t WHERE ${clauses.join(' AND ')} ORDER BY ${order}`).all(...params).map(r => this.hydrateTask(r));
  }

  listRunnableTasks(limit = 20, nowMs = Date.now()) {
    const rows = this.db.prepare(`SELECT * FROM tasks WHERE status=? AND deleted_at IS NULL AND cancel_requested_at IS NULL ORDER BY status_entered_at ASC LIMIT ?`)
      .all(TaskStatus.READY, Math.max(limit * 4, limit));
    return rows.map(r => this.hydrateTask(r)).filter(task => {
      const retry = task.executionState?.retry;
      if (task.ready_reason === ReadyReason.SUSPENDED || retry?.paused) return false;
      return !retry?.nextAt || new Date(retry.nextAt).getTime() <= nowMs;
    }).slice(0,limit);
  }

  getTask(id) {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    return row ? this.hydrateTask(row) : null;
  }

  hydrateTask(row) {
    const scopes = this.db.prepare(`SELECT s.*,p.name AS project_name,p.path AS project_path FROM task_project_scopes s LEFT JOIN projects p ON p.id=s.project_id WHERE s.task_id=? ORDER BY s.id`).all(row.id);
    const refs = this.db.prepare(`SELECT r.source_task_id,t.title,t.final_result,t.completed_at FROM task_references r JOIN tasks t ON t.id=r.source_task_id WHERE r.target_task_id=? ORDER BY r.id`).all(row.id);
    const pendingGateway = this.db.prepare(`SELECT * FROM human_gateways WHERE task_id=? AND status='PENDING' ORDER BY created_at DESC LIMIT 1`).get(row.id);
    const attachments = this.db.prepare(`SELECT id,name,mime_type,size_bytes,path,created_at FROM task_attachments WHERE task_id=? ORDER BY created_at,id`).all(row.id);
    return {
      ...row,
      locked: Boolean(row.locked),
      ready_reason: migrateReadyReason(row.ready_reason),
      completion_reason: row.completion_reason || (row.status === TaskStatus.COMPLETED ? CompletionReason.SUCCESS : null),
      executionState: migrateExecutionState(parseJson(row.execution_state_json, null)),
      analysisState: parseJson(row.analysis_state_json, null),
      projectScopes: scopes.map(s => ({ source:s.source, projectId:s.project_id, label:s.source === 'registry' ? (s.project_name || s.label) : (s.label || '临时项目范围'), path:s.source === 'registry' ? (s.project_path || s.path) : s.path })),
      references: refs,
      attachments: attachments.map(a => ({ id:a.id,name:a.name,mimeType:a.mime_type,size:Number(a.size_bytes),path:a.path,createdAt:a.created_at })),
      pendingGateway: pendingGateway ? { ...pendingGateway, targetGapId:pendingGateway.target_gap_id||null, options:parseJson(pendingGateway.options_json,[]) } : null,
    };
  }

  getAttachment(taskId, attachmentId) {
    const row = this.db.prepare(`SELECT id,task_id,name,mime_type,size_bytes,path,created_at FROM task_attachments WHERE task_id=? AND id=?`).get(taskId,attachmentId);
    return row ? { id:row.id,taskId:row.task_id,name:row.name,mimeType:row.mime_type,size:Number(row.size_bytes),path:row.path,createdAt:row.created_at } : null;
  }

  transitionTask(id, nextStatus, { finalResult = null, lastStageResult = undefined, readyReason = undefined, completionReason = undefined, clearCancel = false, executionState = undefined } = {}) {
    const task = this.getTask(id);
    if (!task) throw new Error('TASK_NOT_FOUND');
    const now = this.now();
    this.store.transaction(() => {
      this.db.prepare('UPDATE task_phase_history SET exited_at=? WHERE task_id=? AND exited_at IS NULL').run(now,id);
      this.db.prepare('INSERT INTO task_phase_history(task_id,phase,entered_at) VALUES (?,?,?)').run(id,nextStatus,now);
      const completedAt = nextStatus === TaskStatus.COMPLETED ? now : null;
      const completion = nextStatus === TaskStatus.COMPLETED ? (completionReason || CompletionReason.SUCCESS) : null;
      this.db.prepare(`UPDATE tasks SET status=?,status_entered_at=?,completed_at=?,completion_reason=?,
        final_result=COALESCE(?,final_result),
        last_stage_result=CASE WHEN ? IS NULL THEN last_stage_result ELSE ? END,
        ready_reason=COALESCE(?,ready_reason),
        cancel_requested_at=CASE WHEN ? THEN NULL ELSE cancel_requested_at END,
        execution_state_json=CASE WHEN ? THEN ? ELSE execution_state_json END
        WHERE id=?`).run(nextStatus,now,completedAt,completion,finalResult,lastStageResult ?? null,lastStageResult ?? null,readyReason ?? null,clearCancel ? 1 : 0,executionState !== undefined ? 1 : 0,executionState == null ? null : JSON.stringify(executionState),id);
    });
    return this.getTask(id);
  }

  touchTask(id, { readyReason = undefined, executionState = undefined } = {}) {
    const task = this.getTask(id);
    if (!task) throw new Error('TASK_NOT_FOUND');
    // Updating READY metadata is not a lifecycle transition. Keep
    // status_entered_at stable so list ordering/time continues to mean
    // "when this Task entered the current user-visible status".
    this.db.prepare(`UPDATE tasks SET ready_reason=COALESCE(?,ready_reason),execution_state_json=CASE WHEN ? THEN ? ELSE execution_state_json END WHERE id=?`)
      .run(readyReason ?? null,executionState !== undefined ? 1 : 0,executionState == null ? null : JSON.stringify(executionState),id);
    return this.getTask(id);
  }

  updateStageResult(id, stageResult) { this.db.prepare('UPDATE tasks SET last_stage_result=? WHERE id=?').run(stageResult || null,id); return this.getTask(id); }
  setExecutionState(id, state) { this.db.prepare('UPDATE tasks SET execution_state_json=? WHERE id=?').run(state == null ? null : JSON.stringify(state),id); return this.getTask(id); }

  setAnalysisState(id, state) { this.db.prepare('UPDATE tasks SET analysis_state_json=? WHERE id=?').run(state == null ? null : JSON.stringify(state),id); return this.getTask(id); }
  commitCertifiedTurn(taskId, { analysisState, historyCommit = null }) {
    const task = this.getTask(taskId);
    if (!task) throw new Error('TASK_NOT_FOUND');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('UPDATE tasks SET analysis_state_json=? WHERE id=?').run(analysisState == null ? null : JSON.stringify(analysisState),taskId);
      if (historyCommit?.title && historyCommit?.detail) {
        const at = historyCommit.completedAt || this.now();
        this.db.prepare('INSERT INTO task_progress_history(task_id,title,detail,completed_at) VALUES (?,?,?,?)').run(taskId,historyCommit.title,historyCommit.detail,at);
        this.db.prepare('UPDATE tasks SET last_stage_result=? WHERE id=?').run(historyCommit.detail || null,taskId);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original write error */ }
      throw error;
    }
    return this.getTask(taskId);
  }
  setCancelRequested(id, value = true) { this.db.prepare('UPDATE tasks SET cancel_requested_at=? WHERE id=?').run(value ? this.now() : null,id); return this.getTask(id); }
  setDeleted(id, value = true) { this.db.prepare('UPDATE tasks SET deleted_at=? WHERE id=?').run(value ? this.now() : null,id); return this.getTask(id); }
  setLocked(id, locked) { this.db.prepare('UPDATE tasks SET locked=? WHERE id=?').run(locked ? 1 : 0,id); return this.getTask(id); }

  createGatewayRecord(taskId, { question, context = '', options = [], gapId = null, targetGapId = null }) {
    const id = this.store.nextId('gateway','HG');
    const now = this.now();
    const targetGap=String(targetGapId ?? gapId ?? '').trim() || null;
    this.db.prepare(`INSERT INTO human_gateways(id,task_id,status,question,context,target_gap_id,options_json,created_at) VALUES (?,?,?,?,?,?,?,?)`)
      .run(id,taskId,'PENDING',question,context,targetGap,JSON.stringify(options),now);
    return this.getTask(taskId);
  }
  resolveGatewayRecord(taskId, answer) {
    const gateway = this.db.prepare(`SELECT * FROM human_gateways WHERE task_id=? AND status='PENDING' ORDER BY created_at DESC LIMIT 1`).get(taskId);
    if (!gateway) throw new Error('NO_PENDING_GATEWAY');
    this.db.prepare(`UPDATE human_gateways SET status='RESOLVED',answer=?,resolved_at=? WHERE id=?`).run(answer.trim(),this.now(),gateway.id);
    return gateway.id;
  }
  cancelPendingGateway(taskId) {
    this.db.prepare(`UPDATE human_gateways SET status='CANCELLED',resolved_at=? WHERE task_id=? AND status='PENDING'`).run(this.now(),taskId);
  }
  listGatewayHistory(taskId) { return this.db.prepare('SELECT * FROM human_gateways WHERE task_id=? ORDER BY created_at').all(taskId).map(g => ({...g,targetGapId:g.target_gap_id||null,options:parseJson(g.options_json,[])})); }

  addProgressHistory(taskId, { title, detail = '', completedAt = null }) {
    const at = completedAt || this.now();
    this.db.prepare('INSERT INTO task_progress_history(task_id,title,detail,completed_at) VALUES (?,?,?,?)').run(taskId,title,detail,at);
  }
  commitProgressHistory(taskId, { title, detail = '', completedAt = null }) {
    const at = completedAt || this.now();
    // node:sqlite DatabaseSync does not expose better-sqlite3's
    // db.transaction(callback) helper. Keep History + last_stage_result in one
    // explicit SQLite transaction so a failed second write cannot leave a
    // partial History record.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO task_progress_history(task_id,title,detail,completed_at) VALUES (?,?,?,?)').run(taskId,title,detail,at);
      this.db.prepare('UPDATE tasks SET last_stage_result=? WHERE id=?').run(detail || null,taskId);
      this.db.exec('COMMIT');
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch { /* preserve original write error */ }
      throw error;
    }
    return this.getTask(taskId);
  }
  getProgressHistory(taskId) { return this.db.prepare('SELECT id,title,detail,completed_at FROM task_progress_history WHERE task_id=? ORDER BY id').all(taskId); }
  getPhaseHistory(taskId) { return this.db.prepare('SELECT phase,entered_at,exited_at FROM task_phase_history WHERE task_id=? ORDER BY id').all(taskId); }

  listStaleRunningTasks() { return this.db.prepare('SELECT * FROM tasks WHERE status=?').all(TaskStatus.RUNNING).map(r => this.hydrateTask(r)); }

  counts() {
    const rows = this.db.prepare('SELECT status,COUNT(*) AS count FROM tasks WHERE deleted_at IS NULL GROUP BY status').all();
    const result = { READY:0,RUNNING:0,WAITING_HUMAN:0,COMPLETED:0 };
    for (const row of rows) result[row.status] = Number(row.count);
    return result;
  }

  getMaintenanceState(key) {
    const row = this.db.prepare('SELECT value_json FROM maintenance_state WHERE key=?').get(key);
    return row ? parseJson(row.value_json,{}) : null;
  }
  setMaintenanceState(key, value) {
    const now = this.now();
    this.db.prepare(`INSERT INTO maintenance_state(key,value_json,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
      .run(key,JSON.stringify(value),now);
    return value;
  }

  listCleanupCandidates({ today, maxAgeDays = 90 }) {
    const rows = this.db.prepare(`SELECT * FROM tasks WHERE status=? AND locked=0 AND completed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM task_references r WHERE r.source_task_id=tasks.id)`).all(TaskStatus.COMPLETED);
    const todayKey = Date.UTC(today.getFullYear(),today.getMonth(),today.getDate());
    return rows.map(r => this.hydrateTask(r)).filter(task => {
      const d = new Date(task.completed_at);
      const key = Date.UTC(d.getFullYear(),d.getMonth(),d.getDate());
      return Math.floor((todayKey - key) / 86400000) > maxAgeDays;
    });
  }

  hardDeleteCompletedTask(id) {
    const task = this.getTask(id);
    if (!task || task.status !== TaskStatus.COMPLETED || task.locked) return false;
    const referenced = this.db.prepare('SELECT 1 AS x FROM task_references WHERE source_task_id=? LIMIT 1').get(id);
    if (referenced) return false;
    this.store.transaction(() => {
      this.db.prepare('DELETE FROM human_gateways WHERE task_id=?').run(id);
      this.db.prepare('DELETE FROM task_progress_history WHERE task_id=?').run(id);
      this.db.prepare('DELETE FROM task_attachments WHERE task_id=?').run(id);
      this.db.prepare('DELETE FROM task_project_scopes WHERE task_id=?').run(id);
      this.db.prepare('DELETE FROM task_references WHERE target_task_id=?').run(id);
      this.db.prepare('DELETE FROM task_phase_history WHERE task_id=?').run(id);
      this.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
    });
    return true;
  }
}
