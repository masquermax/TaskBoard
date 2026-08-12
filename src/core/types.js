export const TaskStatus = Object.freeze({
  READY: 'READY',
  RUNNING: 'RUNNING',
  WAITING_HUMAN: 'WAITING_HUMAN',
  COMPLETED: 'COMPLETED',
});

export const ReadyReason = Object.freeze({
  NEW: 'NEW',
  HUMAN_REPLY: 'HUMAN_REPLY',
  WAITING_RESOURCE: 'WAITING_RESOURCE',
  RETRY_WAIT: 'RETRY_WAIT',
  SUSPENDED: 'SUSPENDED',
});

export const CompletionReason = Object.freeze({
  SUCCESS: 'SUCCESS',
  CANCELLED: 'CANCELLED',
});

export const WorkUnitStatus = Object.freeze({
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  WAITING_DEPENDENCY: 'WAITING_DEPENDENCY',
  WAITING_RESOURCE: 'WAITING_RESOURCE',
  RETRY_WAIT: 'RETRY_WAIT',
  SUSPENDED: 'SUSPENDED',
});

export const ProjectFilter = Object.freeze({
  ALL: 'all',
  UNREGISTERED: 'unregistered',
});

export function isTaskStatus(value) {
  return Object.values(TaskStatus).includes(value);
}
