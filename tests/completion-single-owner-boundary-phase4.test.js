import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = path => readFileSync(new URL(`../${path}`,import.meta.url),'utf8');

test('Root complete is only a proposal and cannot emit terminal runtime complete directly',()=>{
  const text=source('src/core/root-runtime.js');
  assert.doesNotMatch(text,/if\s*\(decision\.kind\s*===\s*['"]complete['"]\)[\s\S]{0,700}return\s*\{\s*kind\s*:\s*['"]complete['"]/);
});

test('Scheduler cannot translate runtime complete directly into SUCCESS completion',()=>{
  const text=source('src/core/scheduler.js');
  assert.doesNotMatch(text,/if\s*\(outcome\.kind\s*===\s*['"]complete['"]\)[\s\S]{0,900}transitionTask\([^\n]+TaskStatus\.COMPLETED[\s\S]{0,300}CompletionReason\.SUCCESS/);
});

test('Repository never infers SUCCESS merely from TaskStatus.COMPLETED',()=>{
  const text=source('src/core/json-repository.js');
  assert.doesNotMatch(text,/status\s*===\s*TaskStatus\.COMPLETED\s*\?\s*CompletionReason\.SUCCESS/);
  assert.doesNotMatch(text,/completionReason\s*\|\|\s*CompletionReason\.SUCCESS/);
});
