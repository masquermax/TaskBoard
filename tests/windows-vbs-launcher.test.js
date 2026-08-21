import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function readBytes(name) {
  return readFileSync(resolve(ROOT, name));
}

function readAscii(name) {
  const bytes = readBytes(name);
  assert.ok([...bytes].every(byte => byte < 0x80), `${name} must stay ASCII-safe for Windows Script Host`);
  return bytes.toString('ascii');
}

test('Windows VBS launchers stay ASCII-safe with CRLF line endings for Windows Script Host', () => {
  for (const name of ['TaskBoard.vbs','Stop-TaskBoard.vbs','Create-Desktop-Shortcut.vbs']) {
    const bytes=readBytes(name);
    assert.ok([...bytes].every(byte => byte < 0x80), `${name} must stay ASCII-safe for Windows Script Host`);
    const source=bytes.toString('ascii');
    assert.equal((source.match(/\n/g)||[]).length,(source.match(/\r\n/g)||[]).length,`${name} must use CRLF line endings`);
  }
});
