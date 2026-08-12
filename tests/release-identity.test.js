import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path) { return readFileSync(path,'utf8'); }

test('release identity is consistent across executable/package/current release docs',()=>{
  const pkg=JSON.parse(read('package.json'));
  const version=String(pkg.version);
  const app=read('src/version.js');
  const readme=read('README.md');
  const current=read('docs/CURRENT_STATE.md');
  const spec=read('docs/SPECIFICATION.md');
  const architecture=read('docs/ARCHITECTURE.md');
  const codex=read('docs/CODEX_INTEGRATION.md');
  const verification=read('docs/VERIFICATION.md');

  assert.match(app,new RegExp(`APP_VERSION = ['\"]${version.replaceAll('.','\\.')}['\"]`));
  assert.match(readme,new RegExp(`^# TaskBoard Codex v${version.replaceAll('.','\\.')}`,'m'));
  assert.match(current,new RegExp(`^Release: v${version.replaceAll('.','\\.')}$`,'m'));
  assert.match(spec,new RegExp(`^# TaskBoard Specification v${version.replaceAll('.','\\.')}`,'m'));
  assert.match(architecture,new RegExp(`^# TaskBoard Architecture v${version.replaceAll('.','\\.')}`,'m'));
  assert.match(codex,new RegExp(`^# Codex Integration v${version.replaceAll('.','\\.')}`,'m'));
  assert.match(verification,new RegExp(`^# Verification v${version.replaceAll('.','\\.')}$`,'m'));
});