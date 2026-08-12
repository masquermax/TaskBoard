import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export const RUNTIME_SETTING_MIN = 1;
export const RUNTIME_SETTING_MAX = 5;

export const DEFAULT_RUNTIME_SETTINGS = Object.freeze({
  taskConcurrency: 2,
  taskMaxSubagents: 3,
});

function boundedInteger(value, fallback, min = RUNTIME_SETTING_MIN, max = RUNTIME_SETTING_MAX) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

function positiveInteger(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// Current Runtime Contract. No legacy aliases are accepted here.
export function normalizeRuntimeSettings(value = {}, fallback = DEFAULT_RUNTIME_SETTINGS) {
  return {
    taskConcurrency: boundedInteger(value.taskConcurrency, fallback.taskConcurrency),
    taskMaxSubagents: boundedInteger(value.taskMaxSubagents, fallback.taskMaxSubagents),
  };
}

// Upgrade boundary only: old persisted settings are converted once when read.
export function migrateRuntimeSettings(value = {}, fallback = DEFAULT_RUNTIME_SETTINGS) {
  const taskMaxSubagents = value.taskMaxSubagents ?? value.taskMaxThreads ?? value.workerConcurrency;
  return normalizeRuntimeSettings({ taskConcurrency:value.taskConcurrency, taskMaxSubagents }, fallback);
}

// Capability limits are facts reported by the Capability Provider. TaskBoard
// never guesses these values or maps generic concurrency numbers into them.
export function executionLimitsFromCapability(capability = null) {
  const limits = capability?.execution?.limits;
  if (!limits || typeof limits !== 'object') return { taskConcurrency:null, taskMaxSubagents:null };
  return {
    taskConcurrency: positiveInteger(limits.taskConcurrency),
    taskMaxSubagents: positiveInteger(limits.taskMaxSubagents),
  };
}

export function resolveEffectiveRuntimeSettings(configured, capability = null) {
  const settings = normalizeRuntimeSettings(configured);
  const limits = executionLimitsFromCapability(capability);
  return {
    configured:settings,
    limits,
    effective:{
      taskConcurrency:limits.taskConcurrency == null ? settings.taskConcurrency : Math.min(settings.taskConcurrency, limits.taskConcurrency),
      taskMaxSubagents:limits.taskMaxSubagents == null ? settings.taskMaxSubagents : Math.min(settings.taskMaxSubagents, limits.taskMaxSubagents),
    },
  };
}

function validateUserSetting(value, name) {
  if (value == null) return;
  const n=Number(value);
  if (!Number.isInteger(n) || n < RUNTIME_SETTING_MIN || n > RUNTIME_SETTING_MAX) {
    const error=new Error('RUNTIME_SETTINGS_OUT_OF_RANGE');
    error.setting=name;
    throw error;
  }
}

export class RuntimeSettingsStore {
  constructor({ file, env = process.env } = {}) {
    this.file = file;
    const envMaxSubagents = env.TASKBOARD_TASK_MAX_SUBAGENTS ?? env.TASKBOARD_TASK_MAX_THREADS ?? env.TASKBOARD_WORKER_CONCURRENCY;
    this.defaults = normalizeRuntimeSettings({
      taskConcurrency: env.TASKBOARD_TASK_CONCURRENCY == null ? DEFAULT_RUNTIME_SETTINGS.taskConcurrency : Number(env.TASKBOARD_TASK_CONCURRENCY),
      taskMaxSubagents: envMaxSubagents == null ? DEFAULT_RUNTIME_SETTINGS.taskMaxSubagents : Number(envMaxSubagents),
    });
    this.value = this.load();
  }

  load() {
    if (!this.file || !existsSync(this.file)) return { ...this.defaults };
    let parsed;
    try { parsed = JSON.parse(readFileSync(this.file, 'utf8')); }
    catch { return { ...this.defaults }; }
    return migrateRuntimeSettings(parsed, this.defaults);
  }

  get() { return { ...this.value }; }

  update(next = {}) {
    if ('taskMaxThreads' in next || 'workerConcurrency' in next) {
      const error=new Error('RUNTIME_SETTINGS_LEGACY_FIELD');
      error.setting='taskMaxSubagents';
      throw error;
    }
    validateUserSetting(next.taskConcurrency,'taskConcurrency');
    validateUserSetting(next.taskMaxSubagents,'taskMaxSubagents');
    const candidate = normalizeRuntimeSettings({ ...this.value, ...next }, this.value);
    if (this.file) {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(this.file, `${JSON.stringify(candidate, null, 2)}\n`, 'utf8');
    }
    this.value = candidate;
    return this.get();
  }
}
