import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root=process.cwd();
const read=path=>readFileSync(resolve(root,path),'utf8');

function listFiles(dir){
  const out=[];
  for(const entry of readdirSync(resolve(root,dir),{withFileTypes:true})){
    const path=`${dir}/${entry.name}`;
    if(entry.isDirectory())out.push(...listFiles(path));else if(entry.isFile())out.push(path);
  }
  return out;
}

test('runtime source avoids hidden sqlite compatibility dependency',()=>{
  const runtimeFiles=listFiles('src').filter(path=>path.endsWith('.js'));
  for(const file of runtimeFiles)assert.doesNotMatch(read(file),/sqlite|better-sqlite|node:sqlite/i,`${file} should not carry an undeclared sqlite Runtime path`);
});

test('active code has no old blanket mode-to-scope derivation',()=>{
  const files=listFiles('src').filter(path=>path.endsWith('.js'));
  const forbidden=/taskMode\s*===\s*['"]EXECUTION['"][\s\S]{0,180}(?:projectWrite|networkAccess)|resultMode\s*===\s*['"]execution['"][\s\S]{0,180}(?:projectWrite|networkAccess)/i;
  for(const file of files)assert.doesNotMatch(read(file),forbidden,`${file} must not derive Runtime authority from presentation/task mode`);
});

test('Task Core does not import Codex implementation modules',()=>{
  const coreFiles=listFiles('src/core').filter(path=>path.endsWith('.js'));
  for(const file of coreFiles)assert.doesNotMatch(read(file),/extensions\/(?:executors|capabilities|config|surfaces)\/codex|codex-app-server|codex-executor/i,`${file} must stay Executor-independent`);
});

test('Capability Provider remains a read-only fact surface',()=>{
  const capability=read('src/extensions/ports/capability-provider.js');
  assert.match(capability,/discover/);assert.match(capability,/snapshot/);assert.match(capability,/invalidate/);
  assert.doesNotMatch(capability,/update|save|apiKey|baseUrl|writeFile|renameSync/i);
});

test('Task Core model routing remains provider-agnostic',()=>{
  const router=read('src/core/model-router.js');
  assert.doesNotMatch(router,/taskboard_custom|model_providers\.|wire_api|requires_openai_auth|env_key/i);
});

test('Root/Subagent execution requests pass governed model policy rather than provider configuration',()=>{
  for(const file of ['src/core/root-runtime.js','src/core/subagent-runtime.js']){
    const source=read(file);assert.match(source,/modelPolicy/);assert.doesNotMatch(source,/baseUrl|apiKey|providerId|model_providers\./i);
  }
});

test('current runtime contains no removed role or duplicate-domain entry outside migration boundaries',()=>{
  const allowed=new Set([
    'src/core/runtime-settings.js',
    'src/core/runtime-state-migration.js',
    'src/core/retry-policy.js',
  ]);
  const files=[];
  const walk=dir=>{for(const entry of readdirSync(resolve(dir),{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())walk(path);else if(entry.isFile()&&path.endsWith('.js'))files.push(path);}};
  walk('src');
  const forbidden=/SystemFilter|\bOUTSIDE\b|temporaryPath|taskMaxThreads|workerConcurrency|runLead|runWorker|LeadRuntime|WorkerRuntime|ExecutionAdapterPort|ownerLabel|ownerType|RESOURCE_WAIT|pendingSubagentValidation|reviewSubagent|resumeValidation|workerExecutionWindowMs|\bWorker\b|\bworker\b/;
  for(const file of files){if(allowed.has(file))continue;assert.doesNotMatch(readFileSync(resolve(file),'utf8'),forbidden,`legacy current-domain entry leaked into ${file}`);}
});

test('current documentation is one active set and does not reintroduce superseded version artifacts or role names',()=>{
  const expected=[
    'ADR.md','ARCHITECTURE.md','ARCHITECTURE_REVIEW.md','CAPABILITY_CONTRACTS.md','CAPABILITY_MAP.md',
    'CODEX_INTEGRATION.md','CURRENT_STATE.md','EXTENSIONS.md','PRODUCT_CONSTITUTION.md','SPECIFICATION.md','VERIFICATION.md',
  ];
  const actual=readdirSync(resolve('docs')).filter(name=>name.endsWith('.md')).sort();
  assert.deepEqual(actual,expected.slice().sort());
  const currentState=readFileSync(resolve('docs/CURRENT_STATE.md'),'utf8');
  const active=[readFileSync(resolve('README.md'),'utf8'),...actual.filter(name=>name!=='CURRENT_STATE.md').map(name=>readFileSync(resolve('docs',name),'utf8'))].join('\n');
  assert.doesNotMatch(active,/Root Agent|Execution Adapter|TOOL_EXECUTOR|Project Registry|SystemFilter|\bOUTSIDE\b|taskMaxThreads|workerConcurrency|ownerType|ownerLabel|RESOURCE_WAIT|Task maximum threads|VERIFICATION-0\.|RULE_REALIGNMENT|ANALYSIS_RULES/);
  assert.match(currentState,/## Migration-only names/,'legacy names may be documented only in the explicit migration boundary');
});
