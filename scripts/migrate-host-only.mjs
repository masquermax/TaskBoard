import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read=p=>readFileSync(resolve(p),'utf8');
const write=(p,s)=>{mkdirSync(resolve(p,'..'),{recursive:true});writeFileSync(resolve(p),s,'utf8');};
const remove=p=>rmSync(resolve(p),{recursive:true,force:true});
function edit(p,fn){write(p,fn(read(p)));}
function removeTest(text,title){const marker=`test('${title}'`;const start=text.indexOf(marker);if(start<0)return text;const lineStart=text.lastIndexOf('\n',start)+1;const next=text.indexOf('\ntest(',start+marker.length);return next<0?`${text.slice(0,lineStart).trimEnd()}\n`:text.slice(0,lineStart)+text.slice(next+1);}

for(const p of ['src/extensions/builtins','src/extensions/capabilities','src/extensions/config','src/extensions/executors','src/extensions/surfaces','src/server/mock.js','docs/CODEX_INTEGRATION.md','TaskBoard-in-Codex.vbs','scripts/windows-codex-desktop.mjs','scripts/windows-surface-launcher.mjs','.github/workflows/migrate-extension-boundary.yml'])remove(p);

const concreteTests=[
'model-selection-capability.test.js','codex-executor.test.js','embedded-ui-bundle.test.js','windows-codex-desktop.test.js','provider-profile-http-acceptance.test.js','work-unit-observability-codex.test.js','codex-full-flow.test.js','provider-profile-ui-contract.test.js','cdp-host-rpc-bridge.test.js','windows-process.test.js','executor-realizability.test.js','codex-connection-drain.test.js','provider-profile-pluggability.test.js','codex-connection-settings.test.js','cdp-surface-host.test.js','provider-catalog-identity-boundary.test.js','codex-capability-provider.test.js','provider-acceptance.test.js','codex-transport-client.test.js','provider-connection-boundary.test.js','codex-connection-gate.test.js','executor-action-surface-gate-b.test.js','codex-app-server-client.test.js','codex-runtime-resolver.test.js','codex-injection-contract.test.js','codex-runtime-roots-observability.test.js','codex-account-readiness.test.js','codex-exec-client.test.js','codex-runtime-failure.test.js'
];
for(const name of concreteTests)remove(`tests/${name}`);

write('tests/helpers/test-executor.js',`import { ExecutorPort } from '../../src/core/executor-port.js';
function wait(ms,signal){return new Promise((resolve,reject)=>{if(signal?.aborted){const e=new Error('Execution interrupted');e.interrupted=true;return reject(e);}const timer=setTimeout(resolve,ms);signal?.addEventListener?.('abort',()=>{clearTimeout(timer);const e=new Error('Execution interrupted');e.interrupted=true;reject(e);},{once:true});});}
function value(schema={}){if(Array.isArray(schema?.enum)&&schema.enum.length)return schema.enum[0];if(Array.isArray(schema?.type)){if(schema.type.includes('null'))return null;return value({...schema,type:schema.type[0]});}if(schema?.anyOf){const nullable=schema.anyOf.find(item=>item?.type==='null');if(nullable)return null;return value(schema.anyOf[0]||{});}if(schema?.type==='array')return[];if(schema?.type==='boolean')return false;if(schema?.type==='number'||schema?.type==='integer')return 0;if(schema?.type==='object'||schema?.properties){const out={};for(const key of schema.required||[])out[key]=value(schema.properties?.[key]||{});return out;}return '';}
export class TestExecutor extends ExecutorPort{async health(){return{executor:'test',available:true,version:'test',error:null};}async execute(request={}){request.onExecutionStarted?.({test:true});request.onProgress?.({summary:'Test Executor running',detail:'Generic test fixture only.'});await wait(1,request.signal);return value(request.responseContract||{});}}
`);
write('tests/helpers/test-extension-registry.js',`import { ExtensionRegistry, EXTENSION_API_VERSION, OrchestrationMode } from '../../src/extensions/runtime/extension-registry.js';
import { TestExecutor } from './test-executor.js';
export function createTestExtensionRegistry(){return new ExtensionRegistry().register('mock',()=>({apiVersion:EXTENSION_API_VERSION,displayName:'Test Executor',orchestrationMode:OrchestrationMode.TASKBOARD,executor:new TestExecutor(),capabilityProvider:null,connectionSettings:null,continuation:null,presentation:{description:'Generic test fixture'},surfaceHosts:[]}));}
`);

for(const name of readdirSync(resolve('tests')).filter(n=>n.endsWith('.test.js'))){edit(`tests/${name}`,s=>s
.replaceAll("import { MockExecutor } from '../src/extensions/executors/mock/mock-executor.js';","import { TestExecutor as MockExecutor } from './helpers/test-executor.js';")
.replaceAll('import { MockExecutor } from "../src/extensions/executors/mock/mock-executor.js";',"import { TestExecutor as MockExecutor } from './helpers/test-executor.js';")
.replaceAll("import { createBuiltinExtensionRegistry } from '../src/extensions/builtins/index.js';","import { createTestExtensionRegistry as createBuiltinExtensionRegistry } from './helpers/test-extension-registry.js';"));}

edit('tests/runtime-authority-boundary.test.js',s=>removeTest(s.replace("import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';\n",''),'CodexExecutor realizes the Core-compiled Root grant with no Project/network access'));
edit('tests/context-input-scope.test.js',s=>removeTest(s.replace("import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';\n",''),'Core-compiled Subagent request keeps logical refs in semantic context and paths only in runtime scope'));
edit('tests/runtime-observability-semantics.test.js',s=>{s=s.replace("import { loadEmbeddedTaskboardUi } from '../src/extensions/surfaces/cdp/embedded-ui-bundle.js';\n",'');s=removeTest(s,'the Codex embedded surface can bundle the shared Work timing projection');return removeTest(s,'embedded time bundling preserves named imports, aliases and local side-effect module order');});
edit('tests/code-audit-regressions.test.js',s=>removeTest(s,'business progress never exposes raw shell command bodies'));
edit('tests/architecture-hygiene-gate-b.test.js',s=>{s=removeTest(s,'Gate B: Codex transports use grants and factual Work identity, never role identity or a synthetic Work lease');s=s.replace(",executor=source('src/extensions/executors/codex/codex-executor.js')",'').replace('[root,validator,completion,scheduler,executor]','[root,validator,completion,scheduler]').replace("  assert.doesNotMatch(executor,/stageResult|validatorPrompt|validatorSchema|runValidator/);\n",'');return s;});
edit('tests/windows-vbs-launcher.test.js',s=>{s=s.replace("['TaskBoard.vbs','TaskBoard-in-Codex.vbs','Stop-TaskBoard.vbs','Create-Desktop-Shortcut.vbs']","['TaskBoard.vbs','Stop-TaskBoard.vbs','Create-Desktop-Shortcut.vbs']");s=removeTest(s,'TaskBoard-in-Codex launcher keeps the restart-confirmation flow without multiline string continuations');return removeTest(s,'TaskBoard-in-Codex surfaces exact host-launch diagnostics only on failure');});
edit('tests/runtime-log-level.test.js',s=>{s=s.replace("import { CodexAppServerClient } from '../src/extensions/executors/codex/app-server-client.js';\n",'');s=removeTest(s,'normal diagnostics keep info events while debug diagnostics include tool-level detail');s=s.replace("  const embedded=readFileSync(resolve(root,'TaskBoard-in-Codex.vbs'),'utf8');\n",'').replace("  assert.match(embedded,/TASKBOARD_LOG_LEVEL\"\\\) = \"info\"/i);\n",'');return s;});
edit('tests/release-identity.test.js',s=>s.replace("  const codex=read('docs/CODEX_INTEGRATION.md');\n",'').replace("  assert.match(readme,new RegExp(`^# TaskBoard Codex v${escapedVersion}`,'m'));","  assert.match(readme,new RegExp(`^# TaskBoard v${escapedVersion}`,'m'));" ).replace("  assert.match(codex,new RegExp(`^# Codex Integration v${escapedVersion}`,'m'));\n",''));

const pkg=JSON.parse(read('package.json'));pkg.description='Local-first governed AI task board with externally owned pluggable Extensions.';pkg.scripts.dev='node --watch src/server/index.js';for(const key of ['start:mock','test:connection-acceptance','verify:connection'])delete pkg.scripts[key];write('package.json',`${JSON.stringify(pkg,null,2)}\n`);

edit('docs/CAPABILITY_MAP.md',s=>s.replace('| Model/file/command/network operation | Executor | `src/extensions/executors/*` | realizes AuthorizedGrant; no Task judgment |','| Model/file/command/network operation | Executor Extension | `src/extensions/public-api.js` contract + external `TaskBoard-Ecosystem` implementation | realizes AuthorizedGrant; no Task judgment |'));
edit('src/server/index.js',s=>s.replace("import { loadRegisteredExtensions } from '../extensions/runtime/external-extension-loader.js';","import { loadRegisteredExtensionsAsync } from '../extensions/runtime/external-extension-loader.js';").replace('const extensionLoadState = loadRegisteredExtensions(extensionRegistry, {','const extensionLoadState = await loadRegisteredExtensionsAsync(extensionRegistry, {'));

write('src/extensions/runtime/external-extension-loader.js',`import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { EXTENSION_API_VERSION } from './extension-registry.js';
const require=createRequire(import.meta.url);
function normalizeSpecs(value){if(Array.isArray(value))return value.map(item=>String(item||'').trim()).filter(Boolean);return String(value||'').split(';').map(item=>item.trim()).filter(Boolean);}
function moduleTarget(spec,rootDir){const value=String(spec||'').trim();if(!value)return'';const windowsAbsolute=/^[A-Za-z]:[\\\\/]/.test(value);if(isAbsolute(value)||windowsAbsolute||value.startsWith('.'))return resolve(rootDir||process.cwd(),value);return value;}
function descriptorFrom(moduleValue){const preferred=moduleValue?.default;if(preferred&&(preferred.id||preferred.createExtension||preferred.factory||preferred.register))return preferred;return moduleValue;}
function wrappedLoadError(spec,error){const wrapped=new Error(\`EXTERNAL_EXTENSION_LOAD_FAILED:\${spec}\`);wrapped.cause=error;return wrapped;}
function loadDescriptorSync(spec,rootDir){const target=moduleTarget(spec,rootDir);try{return descriptorFrom(require(target));}catch(error){throw wrappedLoadError(spec,error);}}
async function loadDescriptorAsync(spec,rootDir){const target=moduleTarget(spec,rootDir);try{const local=isAbsolute(target)||/^[A-Za-z]:[\\\\/]/.test(target);return descriptorFrom(local?await import(pathToFileURL(target).href):await import(target));}catch(importError){try{return descriptorFrom(require(target));}catch(requireError){throw wrappedLoadError(spec,requireError?.code==='ERR_REQUIRE_ESM'?importError:requireError);}}}
function descriptorFactory(descriptor,spec){const id=String(descriptor?.id||'').trim(),factory=descriptor?.createExtension||descriptor?.factory;if(!id)throw new Error(\`EXTERNAL_EXTENSION_ID_REQUIRED:\${spec}\`);if(typeof factory!=='function')throw new Error(\`EXTERNAL_EXTENSION_FACTORY_REQUIRED:\${id}\`);return{id,factory};}
export function configuredExternalExtensionSpecs(value=process.env.TASKBOARD_EXTERNAL_EXTENSIONS){return normalizeSpecs(value);}
export function registerExternalExtensions(registry,{rootDir=process.cwd(),specs=configuredExternalExtensionSpecs()}={}){for(const spec of normalizeSpecs(specs)){const descriptor=loadDescriptorSync(spec,rootDir);if(typeof descriptor?.register==='function'){descriptor.register(registry);continue;}const{id,factory}=descriptorFactory(descriptor,spec);registry.register(id,factory);}return registry;}
function incompatible(entry){const api=Number(entry?.apiVersion);return Number.isInteger(api)&&api!==EXTENSION_API_VERSION;}
export function loadRegisteredExtensions(registry,{rootDir=process.cwd(),entries=[]}={}){const loadedIds=[],loadErrors={};for(const entry of Array.isArray(entries)?entries:[]){const expectedId=String(entry?.id||'').trim(),spec=String(entry?.entryPath||'').trim();if(!expectedId||!spec)continue;if(incompatible(entry)){loadErrors[expectedId]=\`EXTENSION_API_VERSION_UNSUPPORTED:\${expectedId}:\${entry.apiVersion}\`;continue;}try{const descriptor=loadDescriptorSync(spec,rootDir);if(typeof descriptor?.register==='function')throw new Error(\`EXTENSION_IMPORTED_REGISTRAR_UNSUPPORTED:\${expectedId}\`);const{id,factory}=descriptorFactory(descriptor,spec);if(id!==expectedId)throw new Error(\`EXTENSION_REGISTERED_ID_MISMATCH:\${expectedId}:\${id}\`);registry.register(id,factory);loadedIds.push(id);}catch(error){loadErrors[expectedId]=error?.message||String(error);}}return{loadedIds,loadErrors};}
export async function loadRegisteredExtensionsAsync(registry,{rootDir=process.cwd(),entries=[]}={}){const loadedIds=[],loadErrors={};for(const entry of Array.isArray(entries)?entries:[]){const expectedId=String(entry?.id||'').trim(),spec=String(entry?.entryPath||'').trim();if(!expectedId||!spec)continue;if(incompatible(entry)){loadErrors[expectedId]=\`EXTENSION_API_VERSION_UNSUPPORTED:\${expectedId}:\${entry.apiVersion}\`;continue;}try{const descriptor=await loadDescriptorAsync(spec,rootDir);if(typeof descriptor?.register==='function')throw new Error(\`EXTENSION_IMPORTED_REGISTRAR_UNSUPPORTED:\${expectedId}\`);const{id,factory}=descriptorFactory(descriptor,spec);if(id!==expectedId)throw new Error(\`EXTENSION_REGISTERED_ID_MISMATCH:\${expectedId}:\${id}\`);registry.register(id,factory);loadedIds.push(id);}catch(error){loadErrors[expectedId]=error?.message||String(error);}}return{loadedIds,loadErrors};}
`);

write('README.md',`# TaskBoard v0.9.2

TaskBoard is a local-first governed AI Task runtime. It owns durable Task facts, Root/Subagent orchestration, deterministic validation, Completion evaluation, Scheduler lifecycle and the generic Extension Host.

**TaskBoard contains no concrete Extension implementation.** Every first-party, test/demo and third-party concrete Extension is owned and versioned in \`masquermax/TaskBoard-Ecosystem\`. A stock TaskBoard process may start in management mode until an Executor Extension is explicitly imported and selected.

## Run

Prerequisite: Node.js 16.6+.

1. Start \`TaskBoard.vbs\` or run \`npm start\`.
2. Open \`http://127.0.0.1:4317\`.
3. Import an API-compatible Executor directory from TaskBoard-Ecosystem and select it in Extension management.
4. Restart when requested, then create Tasks.

## Extension boundary

TaskBoard owns only generic Extension contracts, public author API, registry/loading/persistence, generic connection presentation and Surface management. Provider/API/model/transport/desktop integration and every other concrete implementation stay in TaskBoard-Ecosystem. See \`docs/EXTENSIONS.md\`.

## Development

\`\`\`bash
npm install
npm run verify
npm start
\`\`\`

## Canonical documents

- \`docs/PRODUCT_CONSTITUTION.md\` — first principles and non-negotiable repository boundary.
- \`docs/CAPABILITY_MAP.md\` — semantic owners and enforcement map.
- \`docs/CAPABILITY_CONTRACTS.md\` — role/capability projections.
- \`docs/SPECIFICATION.md\` — current product semantics.
- \`docs/ARCHITECTURE.md\` — architecture/runtime model.
- \`docs/EXTENSIONS.md\` — generic Extension Host contract and Ecosystem ownership rule.
- \`docs/ADR.md\` — durable design rationale.
- \`docs/VERIFICATION.md\` — exact-tree verification status.
`);

edit('docs/PRODUCT_CONSTITUTION.md',s=>s.includes('C-006 — Core Repository Never Owns Concrete Extensions')?s:`${s.trimEnd()}\n\n## C-006 — Core Repository Never Owns Concrete Extensions\n\`masquermax/TaskBoard\` 永远只拥有通用 Extension Contract / Public API / Host / Loader / Registry / Persistence / generic management surfaces；任何可被命名、替换、移除的具体 Extension 实现（包括第一方、测试/演示、Codex、Provider、Executor、Surface、Continuation、Automation 以及未来扩展类型）都必须由 \`masquermax/TaskBoard-Ecosystem\` 独立拥有和版本化。不得以“默认内置、发布方便、测试方便、临时兼容、启动兜底”等理由把具体 Extension 复制、vendor、生成或重新提交到任何 TaskBoard 分支。需要默认体验时，通过安装/导入/分发组合解决，不通过污染 Core Repository 解决。\n`);
edit('docs/EXTENSIONS.md',s=>s.includes('Repository ownership — non-negotiable')?s:`${s.trimEnd()}\n\n## Repository ownership — non-negotiable\n\n\`masquermax/TaskBoard\` owns the generic Extension Host only. Every concrete Extension implementation, including first-party defaults and test/demo Extensions, lives in \`masquermax/TaskBoard-Ecosystem\` and is versioned there. No TaskBoard branch may contain, vendor, generate or reintroduce a concrete Extension implementation. Release convenience and default-product composition do not create an exception; composition happens through explicit Extension import/binding.\n`);

write('tests/extension-repository-boundary.test.js',`import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
function files(root){const out=[];if(!existsSync(root))return out;for(const name of readdirSync(root)){const p=join(root,name);if(statSync(p).isDirectory())out.push(...files(p));else out.push(p);}return out;}
test('TaskBoard repository owns only generic Extension Host surfaces',()=>{const root=resolve('src/extensions');assert.deepEqual(readdirSync(root).sort(),['index.js','ports','public-api.js','runtime']);for(const removed of ['builtins','capabilities','config','executors','surfaces'])assert.equal(existsSync(join(root,removed)),false,\`\${removed} belongs in TaskBoard-Ecosystem\`);for(const removed of ['TaskBoard-in-Codex.vbs','docs/CODEX_INTEGRATION.md','scripts/windows-codex-desktop.mjs','scripts/windows-surface-launcher.mjs'])assert.equal(existsSync(resolve(removed)),false,\`\${removed} is concrete-extension material\`);});
test('product source contains no known concrete Extension implementation',()=>{const source=files(resolve('src')).filter(p=>/\\.(?:js|mjs|cjs)$/.test(p)).map(p=>readFileSync(p,'utf8')).join('\\n');assert.doesNotMatch(source,/createCodexExtension|class\\s+CodexExecutor|class\\s+MockExecutor|OpenAI\\.Codex|TASKBOARD_CODEX_/);});
test('durable product rules route every concrete Extension to Ecosystem',()=>{const constitution=readFileSync(resolve('docs/PRODUCT_CONSTITUTION.md'),'utf8'),contract=readFileSync(resolve('docs/EXTENSIONS.md'),'utf8');assert.match(constitution,/Core Repository Never Owns Concrete Extensions/);assert.match(constitution,/TaskBoard-Ecosystem/);assert.match(contract,/Repository ownership — non-negotiable/);assert.match(contract,/No TaskBoard branch may contain/);});
`);

write('.github/workflows/verify.yml',`name: Verify

on:
  push:
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: verify-\${{ github.workflow }}-\${{ github.ref }}
  cancel-in-progress: true

jobs:
  verify:
    timeout-minutes: 10
    strategy:
      fail-fast: false
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Verify generic Host
        run: npm run verify

  fresh-unpack:
    needs: verify
    timeout-minutes: 10
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - name: Build tracked-files archive
        run: git archive --format=tar --output=/tmp/taskboard.tar HEAD
      - name: Verify fresh unpack
        shell: bash
        run: |
          rm -rf /tmp/taskboard-unpack
          mkdir -p /tmp/taskboard-unpack
          tar -xf /tmp/taskboard.tar -C /tmp/taskboard-unpack
          cd /tmp/taskboard-unpack
          npm run verify
`);

remove('scripts/migrate-host-only.mjs');
