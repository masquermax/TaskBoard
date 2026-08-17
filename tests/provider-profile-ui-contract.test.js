import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html=readFileSync(join(process.cwd(),'src/ui/index.html'),'utf8');
const ui=readFileSync(join(process.cwd(),'src/ui/connection-settings.js'),'utf8');
const codexSettings=readFileSync(join(process.cwd(),'src/extensions/config/codex/codex-connection-settings.js'),'utf8');
const router=readFileSync(join(process.cwd(),'src/core/model-router.js'),'utf8');

test('simple AI connection UI is extension-presentation driven without exposing provider internals',()=>{
  assert.match(html,/id="connection-settings-section"/);
  assert.doesNotMatch(html,/connection-base-url|connection-api-key|connection-default-model|Codex 当前账号/,'stock HTML must not encode one Executor connection form');
  assert.match(ui,/presentationState/);
  assert.match(ui,/connectionState/);
  assert.match(ui,/activeProfileId/);
  assert.match(ui,/\.profiles/);
  assert.match(ui,/actions\.save\|\|'saveProfile'/);
  assert.match(ui,/actions\.select\|\|'selectProfile'/);
  assert.match(ui,/actions\.delete\|\|'deleteProfile'/);
  assert.match(ui,/field\.type==='secret'/);
  assert.doesNotMatch(html,/wire_api|env_key|requires_openai_auth|model_providers\./i);
  assert.doesNotMatch(ui,/wire_api|env_key|requires_openai_auth|model_providers\./i);
  assert.doesNotMatch(ui,/connection\.apiKey\b/,'stored secrets must never be projected back into UI state');
});

test('Codex profile fields stay inside the Codex Extension descriptor rather than the TaskBoard UI',()=>{
  assert.match(codexSettings,/kind:'profiles'/);
  assert.match(codexSettings,/key:'baseUrl'[^\n]+type:'url'/);
  assert.match(codexSettings,/key:'apiKey'[^\n]+type:'secret'/);
  assert.match(codexSettings,/key:'defaultModel'[^\n]+type:'model'/);
  assert.match(codexSettings,/Codex 当前账号/);
  assert.doesNotMatch(html,/API Key|API 地址|默认模型（可选）/);
});

test('model entry remains catalog-assisted data rather than a provider-specific allowlist',()=>{
  assert.match(ui,/\/api\/capabilities/);
  assert.match(ui,/body\.capability\?\.models/);
  assert.match(ui,/connection-model-options/);
  assert.match(ui,/field\.type==='model'/);
  assert.doesNotMatch(router,/taskboard_custom|openai|anthropic|gemini|deepseek/i,'Core ModelRouter must stay provider-agnostic');
});
