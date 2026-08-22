import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const layers = Object.freeze({
  module: [
    'tests/task-contract.test.js',
    'tests/repository-contract.test.js',
    'tests/runtime-settings.test.js',
    'tests/retry-policy.test.js',
    'tests/strict-response-schema.test.js',
    'tests/root-plan-contract.test.js',
    'tests/subagent-minimal-boundary.test.js',
    'tests/validator-runtime-boundary.test.js',
    'tests/source-trace-verifier.test.js',
    'tests/completion-evaluator-phase4.test.js',
    'tests/extension-framework.test.js',
    'tests/work-capability-contract.test.js'
  ],
  functional: [
    'tests/full-flow.test.js',
    'tests/http.test.js',
    'tests/authority-http-acceptance.test.js',
    'tests/lifecycle-actions.test.js',
    'tests/extension-management-mode.test.js',
    'tests/extension-management-api.test.js',
    'tests/extension-connection-api.test.js',
    'tests/queue-runtime.test.js',
    'tests/effect-recovery-scheduler.test.js'
  ]
});

const layer = process.argv[2];
const files = layers[layer];

if (!files) {
  console.error(`Unknown test layer: ${layer ?? '<missing>'}. Expected one of: ${Object.keys(layers).join(', ')}`);
  process.exit(2);
}

const missing = files.filter(file => !existsSync(file));
if (missing.length > 0) {
  console.error(`Test layer ${layer} references missing files:\n${missing.map(file => `- ${file}`).join('\n')}`);
  process.exit(2);
}

console.log(`[test-layer] ${layer}: ${files.length} files`);
const result = spawnSync(process.execPath, ['--test', ...files], {
  stdio: 'inherit',
  windowsHide: true
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
