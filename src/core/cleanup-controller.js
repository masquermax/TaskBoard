import { MAX_TOTAL_ATTEMPTS } from './retry-policy.js';

function localDateKey(date) {
  const pad = n => String(n).padStart(2,'0');
  return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
}

function nextLocalOneAm(now) {
  const next = new Date(now);
  next.setHours(1,0,0,0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate()+1);
  return next;
}

export class DailyCleanupController {
  constructor({ repository, attachmentStore, now = () => new Date(), retryIntervalMs = 60 * 60 * 1000, setTimeoutFn = setTimeout, clearTimeoutFn = clearTimeout } = {}) {
    this.repository = repository;
    this.attachmentStore = attachmentStore;
    this.now = now;
    this.retryIntervalMs = retryIntervalMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.running = false;
    this.dailyTimer = null;
    this.retryTimer = null;
    this.started = false;
  }

  startDailySchedule() {
    if (this.started) return;
    this.started = true;
    this.scheduleNextDaily();
  }

  stop() {
    if (this.dailyTimer) this.clearTimeoutFn(this.dailyTimer);
    if (this.retryTimer) this.clearTimeoutFn(this.retryTimer);
    this.dailyTimer = null;
    this.retryTimer = null;
    this.started = false;
  }

  scheduleNextDaily() {
    if (!this.started) return;
    const now = this.now();
    const next = nextLocalOneAm(now);
    const delay = Math.max(1, next.getTime() - now.getTime());
    this.dailyTimer = this.setTimeoutFn(async () => {
      this.dailyTimer = null;
      try { await this.trigger('daily-01:00'); }
      finally { this.scheduleNextDaily(); }
    }, delay);
    this.dailyTimer?.unref?.();
  }

  stateForToday() {
    const today = localDateKey(this.now());
    const current = this.repository.getMaintenanceState('daily_cleanup') || {};
    if (current.date !== today) {
      return { date:today, attemptCount:0, lastAttemptAt:null, nextRetryAt:null, lastSuccessDate:current.lastSuccessDate || null, lastError:null };
    }
    return current;
  }

  scheduleRetry(nextRetryAt) {
    if (this.retryTimer) this.clearTimeoutFn(this.retryTimer);
    const delay = Math.max(1, new Date(nextRetryAt).getTime() - this.now().getTime());
    this.retryTimer = this.setTimeoutFn(() => {
      this.retryTimer = null;
      this.trigger('hourly-retry').catch(error => console.error('[cleanup]', error));
    }, delay);
    this.retryTimer?.unref?.();
  }

  async trigger(source = 'manual') {
    if (this.running) return { skipped:true, reason:'ALREADY_RUNNING' };
    const now = this.now();
    const today = localDateKey(now);
    let state = this.stateForToday();
    if (state.lastSuccessDate === today) return { skipped:true, reason:'ALREADY_SUCCEEDED_TODAY' };
    if (state.attemptCount >= MAX_TOTAL_ATTEMPTS) return { skipped:true, reason:'ATTEMPT_LIMIT_REACHED' };
    if (state.nextRetryAt && now.getTime() < new Date(state.nextRetryAt).getTime()) return { skipped:true, reason:'RETRY_NOT_DUE' };

    this.running = true;
    const attemptCount = Number(state.attemptCount || 0) + 1;
    state = { ...state, date:today, attemptCount, lastAttemptAt:now.toISOString(), nextRetryAt:null, lastError:null, lastSource:source };
    try {
      // Persist the attempt before cleanup so restarts cannot create a sixth attempt.
      // Keep this inside the protected run so a persistence failure cannot leave
      // the controller permanently marked as running.
      this.repository.setMaintenanceState('daily_cleanup', state);
      // Remove orphaned cleanup-trash left after a prior database-success/filesystem-failure
      // before evaluating today's candidates. This is local filesystem maintenance only.
      this.attachmentStore?.purgeCleanupTrash?.();
      const candidates = this.repository.listCleanupCandidates({ today:now, maxAgeDays:90 });
      let deleted = 0;
      for (const task of candidates) {
        const staged = this.attachmentStore?.stageTaskAttachments
          ? this.attachmentStore.stageTaskAttachments(task.attachments || [])
          : null;
        let databaseDeleted = false;
        try {
          databaseDeleted = this.repository.hardDeleteCompletedTask(task.id);
          if (!databaseDeleted) {
            staged?.rollback?.();
            continue;
          }
          if (staged) staged.commit();
          else this.attachmentStore?.removeTaskAttachments?.(task.attachments || []);
          deleted += 1;
        } catch (error) {
          // If the database did not commit, restore attachment directories so a failed
          // cleanup never leaves a retained Task with missing files. After DB commit,
          // leave any .cleanup-* directory for the next purge instead of recreating an orphan.
          if (!databaseDeleted) {
            try { staged?.rollback?.(); } catch { /* original failure remains authoritative */ }
          }
          throw error;
        }
      }
      const success = { ...state, lastSuccessDate:today, completedAt:this.now().toISOString(), nextRetryAt:null, lastError:null, deletedCount:deleted };
      this.repository.setMaintenanceState('daily_cleanup', success);
      return { ok:true, attemptCount, deleted };
    } catch (error) {
      // Any persistence/database error aborts this run. A failed run is never recorded as success.
      const failed = { ...state, lastError:error?.message || String(error) };
      if (attemptCount < MAX_TOTAL_ATTEMPTS) {
        failed.nextRetryAt = new Date(this.now().getTime() + this.retryIntervalMs).toISOString();
      } else {
        failed.nextRetryAt = null;
      }
      try { this.repository.setMaintenanceState('daily_cleanup', failed); }
      catch (stateError) { console.error('[cleanup] failed to record cleanup failure', stateError); }
      if (failed.nextRetryAt) this.scheduleRetry(failed.nextRetryAt);
      return { ok:false, attemptCount, error:failed.lastError, stopped:attemptCount >= MAX_TOTAL_ATTEMPTS };
    } finally {
      this.running = false;
    }
  }
}

export { localDateKey };
