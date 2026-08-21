import { createServer } from 'node:http';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrap } from './bootstrap.js';
import { createApp } from './app.js';
import { createExtensionConnectionHandler } from './extension-connection-api.js';
import { createExtensionManagementHandler } from './extension-management-api.js';
import { presentExtensionLoadState } from './extension-load-presentation.js';
import { ExtensionRegistry } from '../extensions/runtime/extension-registry.js';
import { ImportedExtensionStore } from '../extensions/runtime/imported-extension-store.js';
import { loadRegisteredExtensionsAsync } from '../extensions/runtime/external-extension-loader.js';
import { APP_ID, APP_VERSION } from '../version.js';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '../..');
const port = Number(process.env.PORT || 4317);
const taskboardUrl = process.env.TASKBOARD_URL || `http://127.0.0.1:${port}`;
const runtimeDir = resolve(rootDir, 'data/runtime');
const instanceFile = resolve(runtimeDir, 'taskboard-instance.json');
const systemExtensionDir = resolve(rootDir, 'data/extensions');
mkdirSync(runtimeDir, { recursive: true });
mkdirSync(systemExtensionDir, { recursive: true });

function configuredExtensionRoots() {
  return String(process.env.TASKBOARD_EXTENSION_DIRS || '')
    .split(delimiter)
    .map(value=>value.trim())
    .filter(Boolean);
}

const importedExtensionStore = new ImportedExtensionStore({
  file: resolve(rootDir, 'data/extension-registry.json'),
  rootDir,
});
// Startup scans only deterministic extension roots, never the machine. The stock
// root is data/extensions; extra roots must be explicitly configured.
const extensionDiscoveryState = importedExtensionStore.discoverRoots([
  systemExtensionDir,
  ...configuredExtensionRoots(),
]);
const extensionRegistry = new ExtensionRegistry();
const extensionLoadState = await loadRegisteredExtensionsAsync(extensionRegistry, {
  rootDir,
  entries: importedExtensionStore.entries(),
});
const requestedExecutor = importedExtensionStore.activeExecutorId();
const executorName = requestedExecutor && extensionRegistry.has(requestedExecutor) ? requestedExecutor : null;
if (requestedExecutor && !executorName) {
  console.warn(`[extensions] active Executor ${requestedExecutor} did not load; TaskBoard is starting in management mode`);
}

const runtime = bootstrap({
  rootDir,
  taskboardUrl,
  executorName,
  extensionRegistry,
  allowMissingExecutor: true,
  startScheduler: process.env.TASKBOARD_SCHEDULER !== 'off',
});
if (requestedExecutor && runtime.extensionLoadError) {
  extensionLoadState.loadedIds = extensionLoadState.loadedIds.filter(id => id !== requestedExecutor);
  extensionLoadState.loadErrors[requestedExecutor] = runtime.extensionLoadError;
  console.warn(`[extensions] active Executor ${requestedExecutor} failed activation; TaskBoard is starting in management mode: ${runtime.extensionLoadError}`);
}
const extensionManagementLoadState=presentExtensionLoadState(extensionLoadState);
const requestedUi=importedExtensionStore.activeUiId();
const activeUiEntry=importedExtensionStore.activeUiEntry();
const activeUiReady=Boolean(
  requestedUi &&
  activeUiEntry?.uiRoot &&
  extensionLoadState.loadedIds.includes(requestedUi) &&
  !extensionLoadState.loadErrors[requestedUi] &&
  existsSync(activeUiEntry.uiRoot)
);
const uiRoot=activeUiReady?activeUiEntry.uiRoot:resolve(rootDir,'src/recovery-ui');
if(requestedUi&&!activeUiReady)console.warn(`[extensions] active UI ${requestedUi} is unavailable; serving recovery UI`);
let server = null;
let shuttingDown = false;
let extensionManagementHandler = null;

function removeInstanceFile() {
  try { rmSync(instanceFile, { force: true }); } catch { /* ignore */ }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  runtime.scheduler.beginShutdown?.();
  runtime.cleanup?.stop?.();
  runtime.surfaceManager?.stop?.();
  extensionManagementHandler?.close?.();
  runtime.executor?.close?.();
  await runtime.scheduler.waitForIdle?.(1000);
  removeInstanceFile();
  try { runtime.database.close(); } catch { /* process shutdown must continue */ }
  if (!server) return process.exit(0);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1200).unref();
}

const appHandler = createApp({
  taskService: runtime.taskService,
  executor: runtime.executor,
  scheduler: runtime.scheduler,
  capabilityProvider: runtime.capabilityProvider,
  surfaceManager: runtime.surfaceManager,
  extension: runtime.extension,
  settingsStore: runtime.settingsStore,
  runtimeSettingsState: runtime.runtimeSettingsState,
  applyRuntimeSettings: runtime.applyRuntimeSettings,
  uiRoot,
  onShutdown: shutdown,
  instanceRoot: rootDir,
});
const connectionHandler=createExtensionConnectionHandler({
  connectionSettings:runtime.extension?.connectionSettings||null,
  extension:runtime.extension||null,
});
extensionManagementHandler=createExtensionManagementHandler({
  store: importedExtensionStore,
  registry: runtime.extensionRegistry,
  loadState: extensionManagementLoadState,
  discoveryErrors: extensionDiscoveryState.errors,
  activeExtension: runtime.extension,
  rootDir,
  taskboardUrl,
});
const handler=async(req,res)=>{
  if(await extensionManagementHandler(req,res))return;
  if(await connectionHandler(req,res))return;
  return appHandler(req,res);
};
server = createServer(handler);
server.on('error', error => {
  removeInstanceFile();
  if (error?.code === 'EADDRINUSE') {
    console.error(`TaskBoard cannot listen on 127.0.0.1:${port}: port already in use.`);
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
server.listen(port, '127.0.0.1', () => {
  writeFileSync(instanceFile, JSON.stringify({
    app: APP_ID,
    version: APP_VERSION,
    pid: process.pid,
    port,
    rootDir,
    startedAt: new Date().toISOString(),
    uiExtensionId:activeUiReady?requestedUi:null,
    recoveryUi:!activeUiReady,
  }, null, 2));
  console.log(`TaskBoard running at http://127.0.0.1:${port}`);
  console.log(`Version: ${APP_VERSION}`);
  console.log(`Executor: ${runtime.extension?.displayName||runtime.extension?.id||'未配置'}`);
  console.log(`UI: ${activeUiReady?requestedUi:'recovery'}`);
  console.log(`Storage: ${runtime.storage} (${runtime.storageFile})`);
  if(extensionLoadState.loadedIds.length) console.log(`[extensions] loaded: ${extensionLoadState.loadedIds.join(', ')}`);
  for (const [id, error] of Object.entries(extensionLoadState.loadErrors)) console.warn(`[extensions] ${id}: ${error}`);
  for (const [directory, error] of Object.entries(extensionDiscoveryState.errors||{})) console.warn(`[extensions] discovery ${directory}: ${error}`);
  if(process.env.TASKBOARD_SURFACES==='on') runtime.surfaceManager?.start?.();
  runtime.cleanup?.startDailySchedule?.();
  Promise.resolve(runtime.executor.health?.()).catch(error => ({ error:error?.message || String(error) })).finally(() => {
    runtime.cleanup?.trigger?.('startup-settled').then(result => {
      if (result?.ok) console.log(`[cleanup] startup cleanup complete; deleted=${result.deleted}`);
    }).catch(error => console.error('[cleanup]', error));
  });
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', removeInstanceFile);
