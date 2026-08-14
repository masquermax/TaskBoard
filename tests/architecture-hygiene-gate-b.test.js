import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = path => readFileSync(resolve(path),'utf8');

test('Gate B: AppServerClient does not derive action policy from role identity',()=>{
  const text=source('src/extensions/executors/codex/app-server-client.js');
  assert.doesNotMatch(text,/roleCanExecute|roleCanWrite|roleCanNetwork/);
  assert.doesNotMatch(text,/role\s*===\s*['"]subagent['"][\s\S]{0,220}(commandExecution|fileChange|webSearch)/);
});

test('Gate B: RootRuntime does not use derived taskMode as a Runtime semantic/control source',()=>{
  const text=source('src/core/root-runtime.js');
  assert.doesNotMatch(text,/policyContext\?\.taskMode|policyContext\.taskMode/);
});

test('Gate B: construction-only goal-authority patch scaffolding is absent from the active tree',()=>{
  const obsolete=[
    '.github/workflows/goal-authority-patch.yml',
    'scripts/goal-authority-patch-2.mjs',
    'scripts/goal-authority-patch-3.mjs',
    'scripts/goal-authority-patch-5.mjs',
    'scripts/goal-authority-patch-6.mjs',
    'scripts/goal-authority-patch-7.mjs',
    'scripts/goal-authority-patch-8.mjs',
    'scripts/run-goal-authority-patch-4.mjs',
    'scripts/run-goal-authority-patch-7.mjs',
  ];
  for(const path of obsolete)assert.equal(existsSync(resolve(path)),false,`${path} is obsolete construction scaffolding`);
});

test('Gate B: ACTIVE governance docs do not retain superseded blocking-Gap or taskMode authority rules',()=>{
  const active=[
    'docs/ARCHITECTURE.md',
    'docs/CAPABILITY_CONTRACTS.md',
    'docs/CAPABILITY_MAP.md',
    'docs/SPECIFICATION.md',
  ].map(source).join('\n');
  assert.doesNotMatch(active,/write only in execution Tasks/i);
  assert.doesNotMatch(active,/blocking Gap[^\n]{0,260}(不得|不能)[^\n]{0,120}(调查|Work Unit|delegate|delegation)/i);
  assert.doesNotMatch(active,/(taskMode|Task Mode)[^\n]{0,180}(write authority|写权限|Project write)/i);
});
