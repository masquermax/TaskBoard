import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTaskTime, formatWorkTiming } from '../src/ui/time.js';

test('task time format uses time today, month-day this year, and full date across years', () => {
  // Local Date constructor is intentional: UI formatting follows the user's local timezone.
  const now = new Date(2026, 7, 7, 20, 18, 30);
  assert.equal(formatTaskTime(new Date(2026,7,7,9,5,6).toISOString(), now), '09:05:06');
  assert.equal(formatTaskTime(new Date(2026,6,31,9,5,6).toISOString(), now), '07-31 09:05:06');
  assert.equal(formatTaskTime(new Date(2025,11,31,23,59,58).toISOString(), now), '2025-12-31 23:59:58');
});

test('work timing keeps execution start stable while last activity advances',()=>{
  const now=new Date(2026,7,17,1,46,30);
  const started=new Date(2026,7,17,1,43,8).toISOString();
  const updated=new Date(2026,7,17,1,46,24).toISOString();
  assert.equal(formatWorkTiming({startedAt:started,updatedAt:updated},now),'开始 01:43:08 · 最近活动 01:46:24');
});

test('completed work shows stable start, completion, and elapsed duration',()=>{
  const now=new Date(2026,7,17,1,52,0);
  const started=new Date(2026,7,17,1,43,8).toISOString();
  const completed=new Date(2026,7,17,1,51,17).toISOString();
  assert.equal(formatWorkTiming({startedAt:started,updatedAt:completed,completedAt:completed},now),'01:43:08 → 01:51:17 · 8分9秒');
});
