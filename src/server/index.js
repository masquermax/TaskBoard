import { createServer } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
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
mkdirSync(runtimeDir, { recursive: true });

const importedExtensionStore = new ImportedExtensionStore({
  file: resolve(rootDir, 'data/extension-registry.json'),
  rootDir,
});
// Product Runtime starts from an empty generic registry. Every concrete Extension,
// including Executors, enters only through the user's explicit imported registry.
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
  // Let active Scheduler runs observe the executor interruption and leave their
  // Tasks RUNNING for normal startup recovery. Never close persistence while an
  // in-flight run can still write to it.
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
  modelSelectionState: runtime.modelSelectionState,
  applyModelSelection: runtime.applyModelSelection,
  uiRoot: resolve(rootDir, 'src/ui'),
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
  }, null, 2));
  console.log(`TaskBoard running at http://127.0.0.1:${port}`);
  console.log(`Version: ${APP_VERSION}`);
  console.log(`Executor: ${runtime.extension?.displayName||runtime.extension?.id||'未配置'}`);
  console.log(`Storage: ${runtime.storage} (${runtime.storageFile})`);
  if(extensionLoadState.loadedIds.length) console.log(`[extensions] loaded: ${extensionLoadState.loadedIds.join(', ')}`);
  for (const [id, error] of Object.entries(extensionLoadState.loadErrors)) console.warn(`[extensions] ${id}: ${error}`);
  if(process.env.TASKBOARD_SURFACES==='on') runtime.surfaceManager?.start?.();
  runtime.cleanup?.startDailySchedule?.();
  // Startup cleanup waits until the executor startup/health attempt has settled.
  // Connected OR a definite failure/timeout both count as settled; CONNECTING itself does not.
  Promise.resolve(runtime.executor.health?.()).catch(error => ({ error:error?.message || String(error) })).finally(() => {
    runtime.cleanup?.trigger?.('startup-settled').then(result => {
      if (result?.ok) console.log(`[cleanup] startup cleanup complete; deleted=${result.deleted}`);
    }).catch(error => console.error('[cleanup]', error));
  });
});

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', removeInstanceFile);
