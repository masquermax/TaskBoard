import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html=readFileSync(join(process.cwd(),'src/ui/index.html'),'utf8');
const ui=readFileSync(join(process.cwd(),'src/ui/connection-settings.js'),'utf8');
const router=readFileSync(join(process.cwd(),'src/core/model-router.js'),'utf8');

test('simple AI connection UI is profile-driven without exposing provider internals',()=>{
  assert.match(html,/id="connection-settings-section"/);
  assert.match(html,/id="connection-mode"/);
  assert.match(ui,/activeProfileId/);
  assert.match(ui,/connectionState\.profiles|connection\.profiles/);
  assert.match(ui,/action:'saveProfile'/);
  assert.match(ui,/action:'selectProfile'/);
  assert.match(ui,/action:'deleteProfile'/);
  assert.match(ui,/新增自定义连接/);
  assert.doesNotMatch(html,/wire_api|env_key|requires_openai_auth|model_providers\./i);
  assert.doesNotMatch(ui,/wire_api|env_key|requires_openai_auth|model_providers\./i);
  assert.doesNotMatch(ui,/connection\.apiKey\b/,'stored secrets must never be projected back into UI state');
});

test('model entry remains catalog-assisted data rather than a provider-specific allowlist',()=>{
  assert.match(ui,/\/api\/capabilities/);
  assert.match(ui,/body\.capability\?\.models/);
  assert.match(ui,/connection-model-options/);
  assert.match(html,/id="connection-default-model"/);
  assert.doesNotMatch(router,/taskboard_custom|openai|anthropic|gemini|deepseek/i,'Core ModelRouter must stay provider-agnostic');
});
