import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildEmbeddedDocumentExpression, buildEmbeddedTransportExpression, loadEmbeddedTaskboardUi } from '../src/extensions/surfaces/cdp/embedded-ui-bundle.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../src/ui');

test('embedded UI bundle reuses the real TaskBoard body/CSS/app and declarative extension connection controls without network script tags',()=>{
  const ui=loadEmbeddedTaskboardUi(root);
  assert.match(ui.bodyHtml,/class="app-shell"/);
  assert.doesNotMatch(ui.bodyHtml,/src=["']\/(?:app|connection-settings)\.js/);
  assert.match(ui.css,/\.app-shell/);
  assert.doesNotMatch(ui.appExpression,/^\s*import\s/m);
  assert.doesNotMatch(ui.appExpression,/^\s*export\s/m);
  assert.match(ui.appExpression,/function formatTaskTime/);
  assert.match(ui.appExpression,/__TASKBOARD_APP_READY__/);
  assert.match(ui.appExpression,/taskboard-embedded-app\.js/);
  assert.match(ui.appExpression,/taskboard-embedded-connection-settings\.js/);
  assert.match(ui.appExpression,/\/api\/executor\/connection/);
  assert.match(ui.appExpression,/presentationState/,'embedded settings must consume the active extension presentation schema');
  assert.doesNotMatch(ui.bodyHtml,/Codex 当前账号|TaskBoard 自己启动的 Codex/,'static TaskBoard UI must not encode one Executor connection form');
  assert.doesNotMatch(ui.appExpression,/Codex 当前账号|TaskBoard 自己启动的 Codex/,'generic settings runtime must not branch on Codex presentation');
});

test('embedded transport uses CDP binding RPC and chunked file transfer rather than fetch/XHR',()=>{
  const expression=buildEmbeddedTransportExpression({host:'codex',baseUrl:'http://127.0.0.1:4317',rpcToken:'0123456789abcdef'});
  assert.match(expression,/__TASKBOARD_EMBED_CONFIG__/);
  assert.match(expression,/__taskboardHostRpcV1/);
  assert.match(expression,/0123456789abcdef/);assert.match(expression,/token:cfg\.rpcToken/);
  assert.match(expression,/upload-start/);assert.match(expression,/upload-chunk/);assert.match(expression,/upload-finish/);assert.match(expression,/512\*1024/);
  assert.doesNotMatch(expression,/\bfetch\s*\(/);
  assert.doesNotMatch(expression,/XMLHttpRequest/);
});

test('embedded document is built entirely from local in-memory UI assets',()=>{
  const expression=buildEmbeddedDocumentExpression({bodyHtml:'<div class="app-shell">x</div>',css:'.app-shell{display:grid}'});
  assert.match(expression,/document\.body\.innerHTML/);
  assert.match(expression,/taskboard-embedded-style/);
  assert.doesNotMatch(expression,/http:\/\//);
  assert.doesNotMatch(expression,/<script\b/i);
});
