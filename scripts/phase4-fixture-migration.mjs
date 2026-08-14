import { readFileSync, writeFileSync } from 'node:fs';

const rootRuntimeFixtureFiles = [
  'tests/code-audit-regressions.test.js',
  'tests/evidence-boundary.test.js',
  'tests/goal-debug-regressions.test.js',
  'tests/governance-analysis.test.js',
  'tests/lifecycle-actions.test.js',
  'tests/queue-runtime.test.js',
  'tests/runtime-authority-boundary.test.js',
  'tests/runtime-regressions.test.js',
  'tests/scheduler.test.js',
  'tests/task-service.test.js',
  'tests/turn-learning.test.js',
  'tests/validator-resource-resume.test.js',
];

const helperImport = "import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';";

for (const path of rootRuntimeFixtureFiles) {
  let source = readFileSync(path, 'utf8');
  if (!source.includes("from '../src/core/root-runtime.js'")) {
    console.log(`skip ${path}: no direct RootRuntime import`);
    continue;
  }
  if (!source.includes(helperImport)) {
    const firstImportEnd = source.indexOf('\n', source.indexOf("from '../src/core/root-runtime.js'"));
    if (firstImportEnd < 0) throw new Error(`FIXTURE_IMPORT_ANCHOR_MISSING:${path}`);
    source = source.slice(0, firstImportEnd + 1) + helperImport + '\n' + source.slice(firstImportEnd + 1);
  }
  source = source.replace(/new RootRuntime\(\{(?!\.\.\.successfulCompletionDependenciesForControlFlowTest\(\),)/g,
    'new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),');
  writeFileSync(path, source, 'utf8');
  console.log(`migrated direct RootRuntime fixtures: ${path}`);
}

for (const path of ['tests/full-flow.test.js']) {
  let source = readFileSync(path, 'utf8');
  const importLine = "import { installSuccessfulCompletionFixture } from './helpers/completion-fixture.js';";
  if (!source.includes(importLine)) {
    const firstLineEnd = source.indexOf('\n');
    source = source.slice(0, firstLineEnd + 1) + importLine + '\n' + source.slice(firstLineEnd + 1);
  }
  const anchor = "const runtime=bootstrap({rootDir,executorName:'mock',startScheduler:false});";
  const replacement = anchor + "installSuccessfulCompletionFixture(runtime.rootRuntime);";
  if (source.includes(anchor) && !source.includes(replacement)) source = source.replaceAll(anchor, replacement);
  writeFileSync(path, source, 'utf8');
  console.log(`migrated bootstrap completion fixture: ${path}`);
}

// This test asserted the Step 2 proxy that is intentionally deleted. The new
// work-occurrence tests are the canonical regression for the opposite invariant.
{
  const path='tests/runtime-authority-boundary.test.js';
  let source=readFileSync(path,'utf8');
  const start="test('source-backed analysis cannot complete on the initial Root turn without delegated source work'";
  const next="test('Root completion cannot silently cancel already-issued read-only Work Units'";
  const i=source.indexOf(start);
  const j=source.indexOf(next);
  if(i>=0 && j>i) source=source.slice(0,i)+source.slice(j);
  writeFileSync(path,source,'utf8');
  console.log('removed obsolete legacy-proxy assertion from runtime-authority-boundary');
}

// Direct RootRuntime outcome changed from a terminal Root-owned `complete` to a
// CompletionEvaluator-owned `goal_satisfied` projection.
{
  const path='tests/code-audit-regressions.test.js';
  let source=readFileSync(path,'utf8');
  source=source.replace("assert.equal(outcome.kind,'complete');\n  assert.equal(outcome.finalResult,'完成');",
    "assert.equal(outcome.kind,'goal_satisfied');\n  assert.equal(outcome.proposal.finalResult,'完成');");
  writeFileSync(path,source,'utf8');
}

console.log('Phase 4 fixture migration applied');
