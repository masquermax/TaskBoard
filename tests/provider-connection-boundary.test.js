import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source=path=>readFileSync(resolve(path),'utf8');

test('Provider connection configuration stays extension-owned and outside Task Core/Governance',()=>{
  const settings=source('src/extensions/config/codex/codex-connection-settings.js');
  const extension=source('src/extensions/builtins/codex-extension.js');
  assert.doesNotMatch(settings,/src\/core|\.\.\/\.\.\/core|governance|TaskContract|AuthorizedGrant|taskMode/);
  assert.match(extension,/CodexConnectionSettings/);
  assert.match(extension,/launchProfileProvider/);
  assert.doesNotMatch(extension,/TaskBoardCodexRuntimeResolver|taskboard-codex-runtime-resolver/);
});

test('Provider connection projection preserves Gate B AppServerClient enforcement surfaces',()=>{
  const client=source('src/extensions/executors/codex/app-server-client.js');
  assert.match(client,/permissions:executionGrant\.profile/);
  assert.match(client,/runtimeWorkspaceRoots:executionGrant\.roots/);
  assert.match(client,/forbiddenAmbient=new Set\(\['mcpToolCall','collabToolCall','dynamicToolCall'\]\)/);
  assert.match(client,/launchProfileProvider/);
  assert.doesNotMatch(client,/sandboxPolicy|roleCanExecute|roleCanWrite|roleCanNetwork/);
});

test('Provider rebuild does not resurrect removed Goal-authority construction scaffolding',()=>{
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
  for(const path of obsolete)assert.equal(existsSync(resolve(path)),false,`${path} must remain absent`);
});
