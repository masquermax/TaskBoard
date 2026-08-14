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

{
  const path = 'tests/full-flow.test.js';
  let source = readFileSync(path, 'utf8');
  const importLine = "import { installSuccessfulCompletionFixture } from './helpers/completion-fixture.js';";
  if (!source.includes(importLine)) {
    const firstLineEnd = source.indexOf('\n');
    source = source.slice(0, firstLineEnd + 1) + importLine + '\n' + source.slice(firstLineEnd + 1);
  }
  source = source.replace(/(const runtime\s*=\s*bootstrap\(\{\s*rootDir\s*,\s*executorName\s*:\s*'mock'\s*,\s*startScheduler\s*:\s*false\s*\}\);)(?!\s*installSuccessfulCompletionFixture\(runtime\.rootRuntime\);)/g,
    '$1installSuccessfulCompletionFixture(runtime.rootRuntime);');
  if (!source.includes('installSuccessfulCompletionFixture(runtime.rootRuntime);')) throw new Error('FULL_FLOW_COMPLETION_FIXTURE_NOT_INSTALLED');
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

function replaceExact(path, before, after, label) {
  let source=readFileSync(path,'utf8');
  if(source.includes(before)) source=source.replace(before,after);
  else if(!source.includes(after)) throw new Error(`FIXTURE_ASSERTION_MISSING:${label}:${path}`);
  writeFileSync(path,source,'utf8');
}

// Root decisions remain `kind:complete` proposals. Only RootRuntime.execute()
// outcomes migrate to the evaluator-owned goal_satisfied projection.
replaceExact('tests/code-audit-regressions.test.js',
  "assert.equal(outcome.kind,'complete');\n  assert.equal(outcome.finalResult,'完成');",
  "assert.equal(outcome.kind,'goal_satisfied');\n  assert.equal(outcome.proposal.finalResult,'完成');",
  'code-audit-root-outcome');
replaceExact('tests/evidence-boundary.test.js',
  "assert.equal(outcome.kind,'complete');\n    assert.doesNotMatch(outcome.finalResult,/自由文本/);\n    assert.match(outcome.finalResult,/1\\. ERP→MWMS 两备注是新增逻辑/);\n    assert.match(outcome.finalResult,/【建议】/);\n    assert.match(outcome.finalResult,/【待确认】/);",
  "assert.equal(outcome.kind,'goal_satisfied');\n    assert.doesNotMatch(outcome.proposal.finalResult,/自由文本/);\n    assert.match(outcome.proposal.finalResult,/1\\. ERP→MWMS 两备注是新增逻辑/);\n    assert.match(outcome.proposal.finalResult,/【建议】/);\n    assert.match(outcome.proposal.finalResult,/【待确认】/);",
  'evidence-boundary-root-outcome');

for(const [before,after,label] of [
  ["assert.equal(outcome.kind,'complete');\n  assert.deepEqual(visible.map(item=>item.id),['HG-NEW']);","assert.equal(outcome.kind,'goal_satisfied');\n  assert.deepEqual(visible.map(item=>item.id),['HG-NEW']);",'goal-debug-human-context'],
  ["assert.equal(outcome.kind,'complete');\n  assert.deepEqual(seen,[['HG-RETRY'],['HG-RETRY']]);","assert.equal(outcome.kind,'goal_satisfied');\n  assert.deepEqual(seen,[['HG-RETRY'],['HG-RETRY']]);",'goal-debug-human-retry'],
  ["assert.equal(outcome.kind,'complete','a certified explicit choice must not reopen the same Human Gateway');","assert.equal(outcome.kind,'goal_satisfied','a certified explicit choice must not reopen the same Human Gateway');",'goal-debug-explicit-choice'],
  ["assert.equal(second.kind,'complete','the explicit second answer must converge instead of creating a third identical Gateway');","assert.equal(second.kind,'goal_satisfied','the explicit second answer must converge instead of creating a third identical Gateway');",'goal-debug-second-choice'],
]) replaceExact('tests/goal-debug-regressions.test.js',before,after,label);

replaceExact('tests/governance-analysis.test.js',
  "assert.equal(outcome.kind,'complete');\n  assert.match(outcome.finalResult,/【待确认】/);\n  assert.doesNotMatch(outcome.finalResult,/Validator|Subagent/,'internal role labels must not become user-facing pending items');",
  "assert.equal(outcome.kind,'goal_satisfied');\n  assert.match(outcome.proposal.finalResult,/【待确认】/);\n  assert.doesNotMatch(outcome.proposal.finalResult,/Validator|Subagent/,'internal role labels must not become user-facing pending items');",
  'governance-analysis-visible-gap');
replaceExact('tests/governance-analysis.test.js',
  "assert.equal(outcome.kind,'complete');\n  assert.equal(rootCalls,2);\n  assert.equal(workers,0);",
  "assert.equal(outcome.kind,'goal_satisfied');\n  assert.equal(rootCalls,2);\n  assert.equal(workers,0);",
  'governance-analysis-bounded-rework');

replaceExact('tests/lifecycle-actions.test.js',
  "test('Root Runtime can decide execution is complete but cannot change Task lifecycle state by itself', async () => {",
  "test('Root Runtime may surface evaluator-derived goal satisfaction but cannot change Task lifecycle state by itself', async () => {",
  'lifecycle-test-name');
replaceExact('tests/lifecycle-actions.test.js',
  "assert.equal(outcome.kind, 'complete');",
  "assert.equal(outcome.kind, 'goal_satisfied');",
  'lifecycle-root-outcome');

replaceExact('tests/runtime-authority-boundary.test.js',
  "assert.equal(outcome.kind,'complete');\n  assert.equal(workRuns,2);",
  "assert.equal(outcome.kind,'goal_satisfied');\n  assert.equal(workRuns,2);",
  'runtime-authority-root-outcome');

for(const [before,after,label] of [
  ["assert.equal(outcome.kind,'complete');\n    assert.deepEqual(commits,","assert.equal(outcome.kind,'goal_satisfied');\n    assert.deepEqual(commits,",'runtime-history'],
  ["assert.equal(outcome.kind,'complete');\n    assert.equal(rootCalls,1);","assert.equal(outcome.kind,'goal_satisfied');\n    assert.equal(rootCalls,1);",'runtime-no-grounding'],
  ["assert.equal(outcome.kind,'complete');\n    assert.equal(rootCalls,2);\n    assert.equal(groundingCalls,0);\n    assert.match(outcome.finalResult,/^1\\. 步骤1要求/m);\n    assert.doesNotMatch(outcome.finalResult,/请确认：步骤1要求/);","assert.equal(outcome.kind,'goal_satisfied');\n    assert.equal(rootCalls,2);\n    assert.equal(groundingCalls,0);\n    assert.match(outcome.proposal.finalResult,/^1\\. 步骤1要求/m);\n    assert.doesNotMatch(outcome.proposal.finalResult,/请确认：步骤1要求/);",'runtime-direct-attachment'],
]) replaceExact('tests/runtime-regressions.test.js',before,after,label);

replaceExact('tests/turn-learning.test.js',
  "assert.equal(outcome.kind,'complete');\n  assert.match(outcome.finalResult,/外部备注不可修改/);\n  assert.match(outcome.summary,/1 项已确认/);",
  "assert.equal(outcome.kind,'goal_satisfied');\n  assert.match(outcome.proposal.finalResult,/外部备注不可修改/);\n  assert.match(outcome.proposal.summary,/1 项已确认/);",
  'turn-learning-root-outcome');
replaceExact('tests/turn-learning.test.js',
  "assert.match(outcome.finalResult,/外部备注不可修改/);",
  "assert.match(outcome.proposal.finalResult,/外部备注不可修改/);",
  'turn-learning-restart-output');

console.log('Phase 4 fixture migration applied');
