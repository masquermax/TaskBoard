import { createServer } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bootstrap } from './bootstrap.js';
import { createApp } from './app.js';
import { createExtensionConnectionHandler } from './extension-connection-api.js';
import { APP_ID, APP_VERSION } from '../version.js';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '../..');
const port = Number(process.env.PORT || 4317);
const runtimeDir = resolve(rootDir, 'data/runtime');
const instanceFile = resolve(runtimeDir, 'taskboard-instance.json');
mkdirSync(runtimeDir, { recursive: true });

const runtime = bootstrap({ rootDir, startScheduler: process.env.TASKBOARD_SCHEDULER !== 'off' });
let server = null;
let shuttingDown = false;

function removeInstanceFile() {
  try { rmSync(instanceFile, { force: true }); } catch { /* ignore */ }
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  runtime.scheduler.beginShutdown?.();
  runtime.cleanup?.stop?.();
  runtime.surfaceManager?.stop?.();
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
  uiRoot: resolve(rootDir, 'src/ui'),
  onShutdown: shutdown,
  instanceRoot: rootDir,
});
const connectionHandler=createExtensionConnectionHandler({ connectionSettings:runtime.extension?.connectionSettings||null });
const handler=async(req,res)=>{
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
  console.log(`Executor: ${process.env.TASKBOARD_EXECUTOR || 'codex'}`);
  console.log(`Storage: ${runtime.storage} (${runtime.storageFile})`);
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
