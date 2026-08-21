import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = path => readFileSync(resolve(path),'utf8');

test('Gate B: Codex transports use grants and factual Work identity, never role identity or a synthetic Work lease',()=>{
  for(const path of ['src/extensions/executors/codex/app-server-client.js','src/extensions/executors/codex/exec-client.js']){
    const text=source(path);
    assert.doesNotMatch(text,/roleCanExecute|roleCanWrite|roleCanNetwork|diagnosticContext\?\.role|role\s*===\s*['"](?:root|subagent|validator)['"]/);
    assert.doesNotMatch(text,/subagentExecutionWindowMs|WORK_UNIT_EXECUTION_BOUNDARY|executionBoundary/);
  }
});

test('Gate B: Runtime has no parallel stage-result, semantic History, Validator-model or repair channel',()=>{
  const root=source('src/core/root-runtime.js'),validator=source('src/governance/validator-runtime.js'),completion=source('src/governance/completion-evaluator.js'),scheduler=source('src/core/scheduler.js'),repository=source('src/core/json-repository.js'),executor=source('src/extensions/executors/codex/codex-executor.js');
  for(const text of [root,validator,completion,scheduler,executor])assert.doesNotMatch(text,/planningFeedback|validationFeedback|authorityHandoff|completionFeedback|semanticReviewRoot|runValidator/);
  assert.doesNotMatch(root,/stageResult|lastCommittedStageResult|onProgressCommit|historyCommit/);
  assert.doesNotMatch(validator,/stageResult|deriveNewRootProgress|historyCommit|semanticVerifier|analysisValidator/);
  assert.doesNotMatch(completion,/stageResult|semanticVerifier|analysisValidator|modelVerifier/);
  assert.doesNotMatch(executor,/stageResult|validatorPrompt|validatorSchema|runValidator/);
  assert.doesNotMatch(scheduler,/onProgressCommit|commitProgressHistory|lastStageResult|owner\s*===\s*['"]validator['"]/);
  assert.doesNotMatch(repository,/updateStageResult|commitProgressHistory|lastStageResult|historyCommit/);
  assert.doesNotMatch(repository,/last_stage_result\s*:/,'new Task state must not create the removed stage-result field');
});

test('Gate B: analysis rendering is presentation, never a semantic Validator implementation',()=>{
  const presentation=source('src/governance/analysis-presentation.js'),root=source('src/core/root-runtime.js');
  assert.doesNotMatch(presentation,/class\s+AnalysisResultValidator|modelVerifier|semanticVerifier|runValidator|reviewRoot/);
  assert.match(root,/from '..\/governance\/analysis-presentation\.js'/);
  assert.equal(existsSync(resolve('src/governance/analysis-validator.js')),false,'legacy semantic-Validator filename must stay removed');
});

test('Gate B: removed Runtime wrappers and governance document loaders stay absent',()=>{
  for(const path of [
    'src/core/runtime-telemetry.js',
    'src/governance/governance-loader.js',
    'src/governance/capability-contract-loader.js',
    '.github/workflows/goal-authority-patch.yml',
    'scripts/goal-authority-patch-2.mjs',
    'scripts/goal-authority-patch-3.mjs',
    'scripts/goal-authority-patch-5.mjs',
    'scripts/goal-authority-patch-6.mjs',
    'scripts/goal-authority-patch-7.mjs',
    'scripts/goal-authority-patch-8.mjs',
    'scripts/run-goal-authority-patch-4.mjs',
    'scripts/run-goal-authority-patch-7.mjs',
  ])assert.equal(existsSync(resolve(path)),false,`${path} is obsolete Runtime/construction scaffolding`);
});

test('Gate B: ACTIVE architecture docs retain one owner model only',()=>{
  const active=['README.md','docs/ADR.md','docs/ARCHITECTURE.md','docs/CAPABILITY_CONTRACTS.md','docs/CAPABILITY_MAP.md','docs/SPECIFICATION.md'].map(source).join('\n');
  assert.doesNotMatch(active,/write only in execution Tasks/i);
  assert.doesNotMatch(active,/write[^\n]{0,120}(?:accepted|granted|grants?)?[^\n]{0,40}only[^\n]{0,120}execution[- ]mode/i);
  assert.doesNotMatch(active,/blocking Gap[^\n]{0,260}(不得|不能)[^\n]{0,120}(调查|Work Unit|delegate|delegation)/i);
  assert.doesNotMatch(active,/(taskMode|Task Mode)[^\n]{0,180}(write authority|写权限|Project write)/i);
  assert.doesNotMatch(active,/Analysis History value decision|Root Candidate certification \/ Gap narrowing/i);
  assert.doesNotMatch(active,/Validator[^\n]{0,120}(?:owns|负责|执行)[^\n]{0,120}semantic proof/i,'semantic proof may be named only as an explicit absence, never as Validator authority');
});
