import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT=fileURLToPath(new URL('..',import.meta.url));
const css=readFileSync(`${ROOT}/src/ui/app.css`,'utf8');

test('settings dialog uses structural spacing instead of negative hint offsets',()=>{
  assert.match(css,/#connection-settings-section,#connection-custom-fields\{display:grid;gap:12px;min-width:0\}/);
  assert.match(css,/\.hint\{margin-top:0;line-height:1\.5;overflow-wrap:anywhere\}/);
});

test('dialogs stay inside the viewport and long runtime text can wrap',()=>{
  assert.match(css,/\.dialog-card\{max-height:calc\(100vh - 30px\);overflow-y:auto;overflow-x:hidden\}/);
  assert.match(css,/\.detail-head h2,.detail-section p,.meta-value,.runtime-notice,.runtime-main span,.work-title,.work-detail,.result-body,.action-description\{overflow-wrap:anywhere;word-break:break-word\}/);
});

test('unresolved completed-state projection remains visibly distinct',()=>{
  assert.match(css,/\.mini-badge\.COMPLETED\.unresolved,.phase-badge\.COMPLETED\.unresolved\{background:#f1f1f3;color:#62666c\}/);
});
