import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/ui/extension-management.js',import.meta.url),'utf8');

test('extension import reports success and failure in the management dialog',()=>{
  assert.match(source,/setImportStatus\('扩展已导入，重启 TaskBoard 后生效。'\)/);
  assert.match(source,/setImportStatus\(`导入失败：\$\{error\?\.message\|\|'扩展导入失败'\}`\)/);
});

test('AI connection apply reports progress and result inside the config dialog',()=>{
  assert.match(source,/setDiscoveryStatus\('正在应用 AI 连接…','loading'\)/);
  assert.match(source,/setDiscoveryStatus\('AI 连接已应用。','success'\)/);
  assert.match(source,/setDiscoveryStatus\(`应用失败：\$\{readable\(error\)\|\|'扩展配置保存失败'\}`,'error'\)/);
});
