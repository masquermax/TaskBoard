import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync as readSource } from 'node:fs';
import { installRuntimeLogMirror } from '../src/server/runtime-log-mirror.js';

function fakeStream(seen){return {write(chunk){seen.push(String(chunk));return true;}};}

test('direct server output remains visible and is mirrored to canonical taskboard.log',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-log-'));
  try{
    const logFile=join(dir,'runtime','taskboard.log');
    const stdoutSeen=[];const stderrSeen=[];
    const stdout=fakeStream(stdoutSeen);const stderr=fakeStream(stderrSeen);
    const mirror=installRuntimeLogMirror({logFile,redirected:false,stdout,stderr});
    assert.equal(mirror.enabled,true);
    stdout.write('runtime-out\n');
    stderr.write('runtime-err\n');
    mirror.close();
    assert.deepEqual(stdoutSeen,['runtime-out\n']);
    assert.deepEqual(stderrSeen,['runtime-err\n']);
    assert.equal(readFileSync(logFile,'utf8'),'runtime-out\nruntime-err\n');
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('launcher-owned redirection disables server mirror to prevent duplicate log lines',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-log-'));
  try{
    const logFile=join(dir,'runtime','taskboard.log');
    const stdoutSeen=[];const stderrSeen=[];
    const stdout=fakeStream(stdoutSeen);const stderr=fakeStream(stderrSeen);
    const mirror=installRuntimeLogMirror({logFile,redirected:true,stdout,stderr});
    assert.equal(mirror.enabled,false);
    stdout.write('launcher-owned\n');
    assert.deepEqual(stdoutSeen,['launcher-owned\n']);
    assert.equal(existsSync(logFile),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Windows launcher marks redirected child stdio explicitly',()=>{
  const source=readSource(new URL('../scripts/windows-launcher.mjs',import.meta.url),'utf8');
  assert.match(source,/TASKBOARD_STDIO_REDIRECTED:'1'/);
});
