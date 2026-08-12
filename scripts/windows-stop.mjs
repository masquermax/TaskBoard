import net from 'node:net';
import { getWindowsPortOwner, killWindowsProcessTree, looksLikeTaskBoardProcess } from './windows-process.mjs';
import { requestUrl } from './http-client.mjs';

const url = process.env.TASKBOARD_URL || 'http://127.0.0.1:4317';
const parsed = new URL(url);
const host = parsed.hostname || '127.0.0.1';
const port = Number(parsed.port || 4317);

function sleep(ms) { return new Promise(resolveWait => setTimeout(resolveWait, ms)); }
async function tcpPortOpen(timeoutMs = 500) {
  return new Promise(resolveOpen => {
    const socket = net.createConnection({ host, port });
    let done = false;
    const finish = value => { if (!done) { done = true; socket.destroy(); resolveOpen(value); } };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function graceful() {
  const response = await requestUrl(`${url}/api/system/shutdown`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-taskboard-action': 'shutdown' },
    body: '{}',
    timeoutMs: 2500,
  });
  return Boolean(response?.ok);
}

if (!(await tcpPortOpen())) process.exit(0);
if (await graceful()) {
  for (let i = 0; i < 30; i += 1) {
    await sleep(250);
    if (!(await tcpPortOpen())) process.exit(0);
  }
}

const owner = getWindowsPortOwner(port);
if (owner && looksLikeTaskBoardProcess(owner) && killWindowsProcessTree(owner.pid)) process.exit(0);
console.error(`Port ${port} is still occupied and the owner could not be safely identified as TaskBoard.`);
process.exit(1);
