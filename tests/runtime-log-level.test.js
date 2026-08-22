import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('Windows launchers select a real process log level and launcher replaces a mismatched running mode',()=>{
  const root=resolve(import.meta.dirname,'..');
  const debug=readFileSync(resolve(root,'Start-TaskBoard-Debug.cmd'),'utf8');
  const normal=readFileSync(resolve(root,'TaskBoard.vbs'),'utf8');
  const launcher=readFileSync(resolve(root,'scripts/windows-launcher.mjs'),'utf8');
  const app=readFileSync(resolve(root,'src/server/app.js'),'utf8');
  assert.match(debug,/TASKBOARD_LOG_LEVEL=debug/i);
  assert.match(normal,/TASKBOARD_LOG_LEVEL"\) = "info"/i);
  assert.match(app,/logLevel:runtimeLogLevel\(\)/);
  assert.match(launcher,/sameLogLevel=currentLogLevel===desiredLogLevel/);
  assert.match(launcher,/sameVersion && sameRoot && sameLogLevel/);
});
