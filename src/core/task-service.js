import { existsSync, statSync } from 'node:fs';
import { TaskStatus, ProjectFilter, isTaskStatus } from './types.js';

function cleanPath(value) {
  let path = String(value || '').trim();
  if (path.length >= 2 && ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'")))) {
    path = path.slice(1, -1).trim();
  }
  return path;
}

function requireDirectory(value) {
  const path = cleanPath(value);
  if (!path || !existsSync(path)) throw new Error('PROJECT_PATH_NOT_FOUND');
  let stat;
  try { stat = statSync(path); } catch { throw new Error('PROJECT_PATH_NOT_FOUND'); }
  if (!stat.isDirectory()) throw new Error('PROJECT_PATH_NOT_DIRECTORY');
  return path;
}

export class TaskService {
  constructor(repository, { attachmentStore = null, defaultExecutorKey = 'default' } = {}) {
    this.repository = repository;
    this.attachmentStore = attachmentStore;
    this.defaultExecutorKey = defaultExecutorKey;
  }

  publicTask(task) {
    if (!task) return task;
    const { analysisState:_internalAnalysisState, ...visible } = task;
    return visible;
  }

  listTasks(query = {}) {
    const status = isTaskStatus(query.status) ? query.status : TaskStatus.READY;
    const project = query.project || ProjectFilter.ALL;
    return this.repository.listTasks({ status, title: query.title || '', project }).map(task => this.publicTask(task));
  }

  getTask(id) {
    const task = this.repository.getTask(id);
    if (!task || task.deleted_at) throw new Error('TASK_NOT_FOUND');
    return this.publicTask(task);
  }

  createTask(payload) {
    if (!payload.title?.trim()) throw new Error('TITLE_REQUIRED');
    if (!payload.instruction?.trim()) throw new Error('INSTRUCTION_REQUIRED');
    if (payload.projectId && payload.temporaryProjectPath?.trim()) throw new Error('PROJECT_OR_TEMP_ONLY');

    let temporaryProjectPath = null;
    if (payload.temporaryProjectPath?.trim()) temporaryProjectPath = requireDirectory(payload.temporaryProjectPath);
    if (payload.projectId) {
      const project = this.repository.getProject(payload.projectId);
      if (!project) throw new Error('PROJECT_NOT_FOUND');
      requireDirectory(project.path);
    }

    const files = Array.isArray(payload.attachments) ? payload.attachments : [];
    if (files.length && !this.attachmentStore) throw new Error('ATTACHMENT_STORAGE_UNAVAILABLE');
    const staged = this.attachmentStore ? this.attachmentStore.persist(files) : { attachments: [], cleanup: () => {} };
    try {
      return this.publicTask(this.repository.createTask({
        title: payload.title,
        instruction: payload.instruction,
        projectId: payload.projectId || null,
        temporaryProjectPath,
        referenceTaskIds: Array.isArray(payload.referenceTaskIds) ? payload.referenceTaskIds : [],
        executorKey: this.defaultExecutorKey,
        attachments: staged.attachments,
      }));
    } catch (error) {
      staged.cleanup();
      throw error;
    }
  }


  createProject(payload) {
    if (!payload.name?.trim() || !payload.path?.trim()) throw new Error('PROJECT_FIELDS_REQUIRED');
    const name = payload.name.trim();
    const path = requireDirectory(payload.path);
    const projects = this.repository.listProjects();
    if (projects.some(project => project.name.toLowerCase() === name.toLowerCase())) throw new Error('PROJECT_NAME_EXISTS');
    if (projects.some(project => project.path === path)) throw new Error('PROJECT_PATH_EXISTS');
    return this.repository.createProject({ name, path });
  }

  listProjects() { return this.repository.listProjects(); }
  deleteProject(id) { return this.repository.deleteProject(id); }
  counts() { return this.repository.counts(); }
  phaseHistory(id) { return this.repository.getPhaseHistory(id); }
  progressHistory(id) { return this.repository.getProgressHistory(id); }
  getAttachment(taskId, attachmentId) {
    const attachment = this.repository.getAttachment(taskId, attachmentId);
    if (!attachment) throw new Error('ATTACHMENT_NOT_FOUND');
    if (this.attachmentStore?.owns && !this.attachmentStore.owns(attachment.path)) throw new Error('ATTACHMENT_FILE_NOT_FOUND');
    return attachment;
  }
}
