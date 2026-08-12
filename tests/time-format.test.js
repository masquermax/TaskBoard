import test from 'node:test';
import assert from 'node:assert/strict';
import { formatTaskTime } from '../src/ui/time.js';

test('task time format uses time today, month-day this year, and full date across years', () => {
  // Local Date constructor is intentional: UI formatting follows the user's local timezone.
  const now = new Date(2026, 7, 7, 20, 18, 30);
  assert.equal(formatTaskTime(new Date(2026,7,7,9,5,6).toISOString(), now), '09:05:06');
  assert.equal(formatTaskTime(new Date(2026,6,31,9,5,6).toISOString(), now), '07-31 09:05:06');
  assert.equal(formatTaskTime(new Date(2025,11,31,23,59,58).toISOString(), now), '2025-12-31 23:59:58');
});
