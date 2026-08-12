import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { looksLikeTaskBoardProcess, parseNetstatListeningPid } from '../scripts/windows-process.mjs';

test('parses Windows netstat listener PID for TaskBoard port', () => {
  const sample = `\r\n  Proto  Local Address          Foreign Address        State           PID\r\n  TCP    127.0.0.1:4317         0.0.0.0:0              LISTENING       24680\r\n  TCP    127.0.0.1:5000         0.0.0.0:0              LISTENING       1234\r\n`;
  assert.equal(parseNetstatListeningPid(sample, 4317), 24680);
  assert.equal(parseNetstatListeningPid(sample, 4999), null);
});

test('only classifies a Node TaskBoard-looking process as safe to recover', () => {
  assert.equal(looksLikeTaskBoardProcess({ name:'node.exe', commandLine:'node src/server/index.js', executablePath:'C:\\Program Files\\nodejs\\node.exe' }), true);
  assert.equal(looksLikeTaskBoardProcess({ name:'node.exe', commandLine:'node other-server.js', executablePath:'C:\\Program Files\\nodejs\\node.exe' }), false);
  assert.equal(looksLikeTaskBoardProcess({ name:'python.exe', commandLine:'python app.py', executablePath:'C:\\Python\\python.exe' }), false);
});

test('Codex CDP launcher binds remote debugging to loopback and requires explicit restart confirmation before closing an existing Codex client',()=>{
  const source=readFileSync(join(process.cwd(),'scripts/windows-surface-launcher.mjs'),'utf8');
  const helper=readFileSync(join(process.cwd(),'scripts/windows-codex-desktop.mjs'),'utf8');
  assert.match(source,/--remote-debugging-address=127\.0\.0\.1/);
  assert.match(source,/--restart-existing/);
  assert.match(source,/Restart confirmation is required/);
  assert.match(helper,/TASKBOARD_CODEX_DESKTOP_COMMAND/);
  assert.match(helper,/Get-AppxPackage -Name OpenAI\.Codex/);
  assert.match(helper,/AppxManifest\.xml/);
  assert.match(helper,/ChatGPT\.exe/);
  assert.match(helper,/Stop-Process -Id \$p\.Id -Force/);
  assert.doesNotMatch(helper,/whereCodexDesktop|where\.exe/);
});

test('Windows Codex surface launcher waits for a real attached surface instead of treating HTTP 200 as embed success',()=>{
  const source=readFileSync(join(process.cwd(),'scripts/windows-surface-launcher.mjs'),'utf8');
  assert.match(source,/attachedTargets/);
  assert.match(source,/Codex surface host did not attach to a renderer/);
  assert.match(source,/timeoutMs:35_000/);
});

test('Windows Codex surface launcher retries transient renderer activation and allows only the local CDP origin',()=>{
  const source=readFileSync(join(process.cwd(),'scripts/windows-surface-launcher.mjs'),'utf8');
  assert.match(source,/async function activateSurface\(/);
  assert.match(source,/while\(Date\.now\(\)<deadline\)/);
  assert.match(source,/await sleep\(500\)/);
  assert.match(source,/--remote-allow-origins=http:\/\/127\.0\.0\.1:\$\{port\}/);
  assert.match(source,/--remote-debugging-address=127\.0\.0\.1/);
});


test('Windows Codex surface launcher can recover a stale reachable CDP renderer only after explicit restart confirmation',()=>{
  const source=readFileSync(join(process.cwd(),'scripts/windows-surface-launcher.mjs'),'utf8');
  assert.match(source,/if\(!restartExisting\) fail\(9,/);
  assert.match(source,/renderer could not host TaskBoard/);
  assert.match(source,/Port \$\{port\} already exposes a CDP endpoint/);
  assert.match(source,/will not reuse or terminate an unrelated debugger endpoint/);
});
