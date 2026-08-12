import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

function readBytes(name) {
  return readFileSync(resolve(ROOT, name));
}

function readAscii(name) {
  const bytes = readBytes(name);
  assert.ok([...bytes].every(byte => byte < 0x80), `${name} must stay ASCII-safe for Windows Script Host`);
  return bytes.toString('ascii');
}

test('Windows VBS launchers stay ASCII-safe with CRLF line endings for Windows Script Host', () => {
  for (const name of ['TaskBoard.vbs','TaskBoard-in-Codex.vbs','Stop-TaskBoard.vbs','Create-Desktop-Shortcut.vbs']) {
    const bytes=readBytes(name);
    assert.ok([...bytes].every(byte => byte < 0x80), `${name} must stay ASCII-safe for Windows Script Host`);
    const source=bytes.toString('ascii');
    assert.equal((source.match(/\n/g)||[]).length,(source.match(/\r\n/g)||[]).length,`${name} must use CRLF line endings`);
  }
});

test('TaskBoard-in-Codex launcher keeps the restart-confirmation flow without multiline string continuations', () => {
  const source = readAscii('TaskBoard-in-Codex.vbs');
  assert.match(source, /windows-surface-launcher\.mjs --surface codex/);
  assert.match(source, /If rc = 4 Or rc = 9 Then/);
  assert.match(source, /--restart-existing/);
  assert.doesNotMatch(source, /&\s+_\r?\n/);
  assert.match(source, /WScript\.Quit 0/);
});

test('TaskBoard-in-Codex surfaces exact host-launch diagnostics only on failure', () => {
  const source = readAscii('TaskBoard-in-Codex.vbs');
  assert.match(source, /codex-surface-error\.txt/);
  assert.match(source, /codex-surface\.log/);
});
