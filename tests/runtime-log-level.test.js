import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CodexAppServerClient } from '../src/extensions/executors/codex/app-server-client.js';

test('normal diagnostics keep info events while debug diagnostics include tool-level detail',()=>{
  const info=[];
  const normal=new CodexAppServerClient({command:'unused',logLevel:'info',diagnosticLogger:line=>info.push(line)});
  normal.recordDiagnostic('work-unit-summary',{toolCallCount:89},'info');
  normal.recordDiagnostic('tool-completed',{seq:37},'debug');
  assert.equal(info.length,1);
  assert.match(info[0],/"level":"info"/);
  assert.match(info[0],/"event":"work-unit-summary"/);

  const debug=[];
  const verbose=new CodexAppServerClient({command:'unused',logLevel:'debug',diagnosticLogger:line=>debug.push(line)});
  verbose.recordDiagnostic('work-unit-summary',{toolCallCount:89},'info');
  verbose.recordDiagnostic('tool-completed',{seq:37},'debug');
  assert.equal(debug.length,2);
  assert.match(debug[1],/"level":"debug"/);
  assert.match(debug[1],/"event":"tool-completed"/);
});

test('Windows launchers explicitly select debug versus normal info diagnostics',()=>{
  const root=resolve(import.meta.dirname,'..');
  const debug=readFileSync(resolve(root,'Start-TaskBoard-Debug.cmd'),'utf8');
  const normal=readFileSync(resolve(root,'TaskBoard.vbs'),'utf8');
  const embedded=readFileSync(resolve(root,'TaskBoard-in-Codex.vbs'),'utf8');
  assert.match(debug,/TASKBOARD_LOG_LEVEL=debug/i);
  assert.match(normal,/TASKBOARD_LOG_LEVEL"\) = "info"/i);
  assert.match(embedded,/TASKBOARD_LOG_LEVEL"\) = "info"/i);
});
