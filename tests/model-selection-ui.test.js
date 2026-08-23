import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const html=readFileSync(join(process.cwd(),'src/ui/index.html'),'utf8');
const js=readFileSync(join(process.cwd(),'src/ui/model-selection.js'),'utf8');

test('model selection UI is loaded as a generic TaskBoard routing surface',()=>{
  assert.match(html,/type="module" src="\/model-selection\.js"/);
  assert.match(js,/\/api\/model-selection/);
  assert.match(js,/x-taskboard-action/);
  assert.match(js,/model-selection-section/);
  assert.match(js,/settings-dialog/);
  assert.match(js,/模型选择/);
  assert.match(js,/自动（默认）/);
  assert.doesNotMatch(js,/API Key|activeProfileId|profileId|providerIdForProfile|taskboard_custom|Codex 当前账号/i);
});

test('stale catalog keeps the saved explicit model visibly selected instead of pretending auto',()=>{
  assert.match(js,/pendingOption=selected&&!knownSelected/);
  assert.match(js,/（待确认）/);
  assert.match(js,/select\.disabled=!state\.scope/);
  assert.match(js,/state\.connectionReady&&state\.explicitPerTurn\?'':'disabled'/);
  assert.match(js,/else if\(selected\)note\.textContent=`模型选择 · \$\{label\}\$\{state\.connectionReady\?'':' · 目录待确认'\}`/);
  assert.match(js,/已保存的指定模型会保留/);
});

test('only fresh same-scope invalidation is presented as an automatic fallback',()=>{
  assert.match(js,/MODEL_SELECTION_INVALIDATED/);
  assert.match(js,/已被当前模型目录确认失效，已自动恢复为「自动选择」/);
  assert.match(js,/当前作用域的新鲜模型目录已确认原指定模型不存在/);
  assert.match(js,/MODEL_SELECTION_CATALOG_UNAVAILABLE/);
  assert.match(js,/原有选择已保留/);
});

test('capability refresh completion reloads model selection without coupling to extension settings',()=>{
  assert.match(js,/MutationObserver/);
  assert.match(js,/data-refresh-state/);
  assert.match(js,/refreshButton\.dataset\.refreshState!=='refreshing'/);
  assert.doesNotMatch(js,/\/api\/extensions\/|\/connection/);
});
