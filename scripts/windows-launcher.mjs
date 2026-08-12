import { spawn } from 'node:child_process';
import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs';
import net from 'node:net';
import { requestUrl } from './http-client.mjs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ID, APP_VERSION } from '../src/version.js';
import { getWindowsPortOwner, killWindowsProcessTree, looksLikeTaskBoardProcess } from './windows-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(here, '..');
const url = process.env.TASKBOARD_URL || 'http://127.0.0.1:4317';
const parsedUrl = new URL(url);
const host = parsedUrl.hostname || '127.0.0.1';
const port = Number(parsedUrl.port || 4317);
const runtimeDir = resolve(rootDir, 'data/runtime');
mkdirSync(runtimeDir, { recursive: true });
const logFile = resolve(runtimeDir, 'taskboard.log');

function appendLog(message) {
  const fd = openSync(logFile, 'a');
  try { writeSync(fd, `${message}\n`); } finally { closeSync(fd); }
}

function sleep(ms) { return new Promise(resolveWait => setTimeout(resolveWait, ms)); }

async function request(path, options = {}, timeoutMs = 1800) {
  return requestUrl(`${url}${path}`, {
    method: options.method || 'GET',
    headers: options.headers || {},
    body: options.body ?? null,
    timeoutMs,
  });
}

async function tcpPortOpen(timeoutMs = 500) {
  return new Promise(resolveOpen => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = value => {
      if (done) return;
      done = true;
      socket.destroy();
      resolveOpen(value);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function currentTaskBoardInfo() {
  const response = await request('/api/live');
  if (!response?.ok) return null;
  try {
    const body = await response.json();
    if (body?.ok === true && body?.app === APP_ID) return body;
    return null;
  } catch {
    return null;
  }
}

async function legacyTaskBoardRunning() {
  // v0.1.5-v0.1.8 may not expose a versioned /api/live marker.
  const response = await request('/api/dashboard', {}, 2500);
  if (!response?.ok) return false;
  try {
    const body = await response.json();
    const counts = body?.counts;
    return !!counts
      && typeof counts === 'object'
      && Object.prototype.hasOwnProperty.call(counts, 'RUNNING')
      && Object.prototype.hasOwnProperty.call(counts, 'WAITING_HUMAN')
      && Object.prototype.hasOwnProperty.call(counts, 'COMPLETED')
      && Array.isArray(body?.projects);
  } catch {
    return false;
  }
}

async function waitForPortClosed(maxMs = 10_000) {
  const end = Date.now() + maxMs;
  while (Date.now() < end) {
    if (!(await tcpPortOpen(350))) return true;
    await sleep(250);
  }
  return !(await tcpPortOpen(350));
}

async function requestGracefulShutdown() {
  return request('/api/system/shutdown', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-taskboard-action': 'shutdown' },
    body: '{}',
  }, 2500);
}

async function stopLegacyOrStaleTaskBoard() {
  appendLog(`[launcher] ${new Date().toISOString()} existing TaskBoard detected; requesting graceful shutdown`);
  const response = await requestGracefulShutdown();
  if (response?.ok && await waitForPortClosed()) return true;

  // If HTTP is wedged, identify the Windows listener rather than blindly
  // spawning another copy. Only force-stop a process that clearly looks like
  // this TaskBoard's Node server.
  const owner = getWindowsPortOwner(port);
  if (owner && looksLikeTaskBoardProcess(owner)) {
    appendLog(`[launcher] ${new Date().toISOString()} stale TaskBoard listener pid=${owner.pid}; force-stopping process tree`);
    if (killWindowsProcessTree(owner.pid) && await waitForPortClosed(6_000)) return true;
  }
  return false;
}

// Reuse only the exact same build from the exact same installation root.
// When the user upgrades by unpacking a new version into a new directory, an
// older TaskBoard may still own 4317; in that case replace it automatically.
const current = await currentTaskBoardInfo();
if (current) {
  const normalizeRoot = value => String(value || '').replace(/[\\/]+$/, '').toLowerCase();
  const sameVersion = current.version === APP_VERSION;
  const sameRoot = normalizeRoot(current.rootDir) === normalizeRoot(rootDir);
  if (sameVersion && sameRoot) {
    appendLog(`[launcher] ${new Date().toISOString()} TaskBoard ${current.version} already running from this installation at ${url}`);
    process.exit(0);
  }
  appendLog(`[launcher] ${new Date().toISOString()} replacing running TaskBoard version=${current.version || '?'} root=${current.rootDir || '?'} with ${APP_VERSION} root=${rootDir}`);
  if (!(await stopLegacyOrStaleTaskBoard())) {
    appendLog(`[launcher] ${new Date().toISOString()} failed to replace running TaskBoard on ${host}:${port}`);
    process.exit(4);
  }
}

// Never trust HTTP alone for port ownership. A stale/wedged process can keep
// LISTENING while refusing HTTP requests, which caused the v0.1.6-v0.1.8 loop.
if (await tcpPortOpen()) {
  if (await legacyTaskBoardRunning()) {
    if (!(await stopLegacyOrStaleTaskBoard())) {
      appendLog(`[launcher] ${new Date().toISOString()} failed to stop older TaskBoard instance on ${host}:${port}`);
      console.error('An older TaskBoard is still using port 4317 and could not be stopped.');
      process.exit(4);
    }
  } else {
    const owner = getWindowsPortOwner(port);
    if (owner && looksLikeTaskBoardProcess(owner)) {
      appendLog(`[launcher] ${new Date().toISOString()} unresponsive TaskBoard listener pid=${owner.pid}; recovering stale process`);
      if (!(killWindowsProcessTree(owner.pid) && await waitForPortClosed(6_000))) {
        appendLog(`[launcher] ${new Date().toISOString()} could not recover stale TaskBoard pid=${owner.pid}`);
        process.exit(4);
      }
    } else {
      appendLog(`[launcher] ${new Date().toISOString()} port conflict on ${host}:${port}; owner=${JSON.stringify(owner)}`);
      console.error(`Port ${port} is already used by another application.`);
      process.exit(5);
    }
  }
}

appendLog(`\n[launcher] ${new Date().toISOString()} starting TaskBoard ${APP_VERSION}; node=${process.version}`);
const logFd = openSync(logFile, 'a');
try {
  const child = spawn(process.execPath, ['src/server/index.js'], {
    cwd: rootDir,
    windowsHide: true,
    detached: true,
    stdio: ['ignore', logFd, logFd],
    env: process.env,
  });
  child.unref();
  appendLog(`[launcher] spawned pid=${child.pid}`);
} catch (error) {
  appendLog(`[launcher] spawn failed: ${error.stack || error.message}`);
  closeSync(logFd);
  throw error;
}
closeSync(logFd);

let ready = null;
for (let i = 0; i < 80; i += 1) {
  await sleep(250);
  ready = await currentTaskBoardInfo();
  if (ready) break;
}

if (!ready) {
  const owner = getWindowsPortOwner(port);
  appendLog(`[launcher] ${new Date().toISOString()} startup liveness check failed; portOpen=${await tcpPortOpen()} owner=${JSON.stringify(owner)}`);
  console.error(`TaskBoard failed to start. See ${logFile}`);
  process.exit(1);
}

appendLog(`[launcher] ${new Date().toISOString()} TaskBoard ${ready.version || APP_VERSION} ready at ${url}`);
process.exit(0);
