import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAppServerClient } from '../src/extensions/executors/codex/app-server-client.js';

function createFakeCodex(dir) {
  const file = join(dir, 'codex-fake.mjs');
  writeFileSync(file, `#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-fake 1.0'); process.exit(0); }
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') return send({ id:msg.id, result:{ userAgent:'fake' } });
  if (msg.method === 'account/read') return send({ id:msg.id, result:{ account:{ type:'chatgpt', planType:'plus' }, requiresOpenaiAuth:true } });
  if (msg.method === 'thread/start') return send({ id:msg.id, result:{ thread:{ id:'thr_test', ephemeral:true } } });
  if (msg.method === 'turn/start') {
    send({ id:msg.id, result:{ turn:{ id:'turn_test', status:'inProgress', items:[] } } });
    setTimeout(() => {
      send({ method:'item/completed', params:{ threadId:'thr_test', turnId:'turn_test', item:{ id:'msg_1', type:'agentMessage', text:'{"kind":"complete","summary":"ok","stageResult":"done","finalResult":"done","gateway":null,"delegations":[]}' } } });
      // Deliberately leave turn.items empty: item/completed is canonical.
      send({ method:'turn/completed', params:{ threadId:'thr_test', turn:{ id:'turn_test', status:'completed', items:[], error:null } } });
    }, 10);
  }
});
`);
  chmodSync(file, 0o755);
  return file;
}

test('Codex app-server client reads final agentMessage from item/completed', async () => {
  if (process.platform === 'win32') return; // executable shebang fixture is POSIX-only
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-fake-codex-'));
  const command = createFakeCodex(dir);
  const diagnostics=[];
  const client = new CodexAppServerClient({ command, diagnosticLogger:line=>diagnostics.push(line) });
  try {
    const health = await client.health();
    assert.equal(health.connected, true);
    assert.equal(health.authenticated, true);
    assert.equal(client.connectionGeneration, 1);
    const text = await client.runTurn({
      cwd: dir,
      writableRoots: [],
      prompt: 'test',
      inputItems: [],
      outputSchema: { type:'object' },
      networkAccess: false,
    });
    assert.match(text, /"kind":"complete"/);
    assert.equal(client.activeTurnCount,0);
    const events=diagnostics.map(line=>JSON.parse(line.replace(/^\[codex-runtime\] /,'')));
    assert.ok(events.some(item=>item.event==='turn-started'&&item.activeTurnCount===1));
    assert.ok(events.some(item=>item.event==='turn-completed'&&item.activeTurnCount===1));
    assert.ok(events.some(item=>item.event==='turn-released'&&item.activeTurnCount===0));
  } finally {
    client.close();
    rmSync(dir, { recursive:true, force:true });
  }
});

test('Codex turn accounting releases capacity even when the execution-start callback throws', async () => {
  if (process.platform === 'win32') return;
  const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-callback-'));
  const command=createFakeCodex(dir);
  const diagnostics=[];
  const client=new CodexAppServerClient({command,diagnosticLogger:line=>diagnostics.push(line)});
  try {
    await assert.rejects(client.runTurn({
      cwd:dir,writableRoots:[],prompt:'test',inputItems:[],outputSchema:{type:'object'},networkAccess:false,
      onExecutionStarted(){throw new Error('execution-start callback failed');},
    }),/execution-start callback failed/);
    assert.equal(client.activeTurnCount,0);
    const events=diagnostics.map(line=>JSON.parse(line.replace(/^\[codex-runtime\] /,'')));
    assert.ok(events.some(item=>item.event==='turn-started'));
    assert.ok(events.some(item=>item.event==='turn-failed'));
    assert.ok(events.some(item=>item.event==='turn-released'&&item.activeTurnCount===0));
  } finally { client.close(); rmSync(dir,{recursive:true,force:true}); }
});

function createSandboxStrictFakeCodex(dir) {
  const file = join(dir, 'codex-sandbox-strict.mjs');
  writeFileSync(file, `#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-fake 0.147.0'); process.exit(0); }
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') return send({ id:msg.id, result:{} });
  if (msg.method === 'thread/start') {
    if ('sandbox' in msg.params) return send({ id:msg.id, error:{ code:-32600, message:'thread sandbox spelling is version-sensitive' } });
    return send({ id:msg.id, result:{ thread:{ id:'thr_strict', ephemeral:true } } });
  }
  if (msg.method === 'turn/start') {
    if (msg.params?.sandboxPolicy?.type !== 'workspace-write') {
      return send({ id:msg.id, error:{ code:-32600, message:'Invalid request: unknown variant workspaceWrite, expected one of read-only, workspace-write, danger-full-access' } });
    }
    if (msg.params?.effort !== 'high') return send({ id:msg.id, error:{ code:-32602, message:'missing expected effort override' } });
    send({ id:msg.id, result:{ turn:{ id:'turn_strict', status:'inProgress', items:[] } } });
    setTimeout(() => {
      send({ method:'item/completed', params:{ threadId:'thr_strict', turnId:'turn_strict', item:{ type:'agentMessage', text:'{"kind":"complete"}' } } });
      send({ method:'turn/completed', params:{ threadId:'thr_strict', turn:{ id:'turn_strict', status:'completed', items:[], error:null } } });
    }, 5);
  }
});
`);
  chmodSync(file, 0o755);
  return file;
}

test('Codex app-server uses 0.147-compatible kebab-case workspace sandbox without thread-level sandbox', async () => {
  if (process.platform === 'win32') return;
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-fake-codex-sandbox-'));
  const command = createSandboxStrictFakeCodex(dir);
  const client = new CodexAppServerClient({ command });
  try {
    const text = await client.runTurn({
      cwd:dir, writableRoots:[dir], prompt:'test', inputItems:[], outputSchema:{type:'object'}, reasoningEffort:'high', networkAccess:false,
    });
    assert.match(text, /"kind":"complete"/);
  } finally { client.close(); rmSync(dir,{recursive:true,force:true}); }
});

function createInterruptFakeCodex(dir) {
  const file = join(dir, 'codex-interrupt.mjs');
  writeFileSync(file, `#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-fake 0.147.0'); process.exit(0); }
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') return send({ id:msg.id, result:{} });
  if (msg.method === 'thread/start') return send({ id:msg.id, result:{ thread:{ id:'thr_interrupt', ephemeral:true } } });
  if (msg.method === 'turn/start') return send({ id:msg.id, result:{ turn:{ id:'turn_interrupt', status:'inProgress', items:[] } } });
  if (msg.method === 'turn/interrupt') {
    if (msg.params?.threadId !== 'thr_interrupt' || msg.params?.turnId !== 'turn_interrupt') return send({ id:msg.id, error:{code:-32602,message:'wrong interrupt ids'} });
    send({ id:msg.id, result:{} });
    setTimeout(() => send({ method:'turn/completed', params:{ threadId:'thr_interrupt', turn:{ id:'turn_interrupt', status:'interrupted', items:[], error:null } } }), 5);
  }
});
`);
  chmodSync(file, 0o755);
  return file;
}

test('Codex cancellation interrupts the active turn and reports an interrupted execution', async () => {
  if (process.platform === 'win32') return;
  const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-interrupt-'));
  const command=createInterruptFakeCodex(dir);
  const client=new CodexAppServerClient({command});
  const controller=new AbortController();
  try {
    const running=client.runTurn({cwd:dir,writableRoots:[],prompt:'long task',inputItems:[],outputSchema:{type:'object'},networkAccess:false,signal:controller.signal});
    setTimeout(()=>controller.abort(),40);
    await assert.rejects(running,error=>Boolean(error?.interrupted));
  } finally { client.close(); rmSync(dir,{recursive:true,force:true}); }
});

function createExitAfterTurnStartFakeCodex(dir) {
  const file = join(dir, 'codex-exit-after-turn-start.mjs');
  writeFileSync(file, `#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-fake 1.0'); process.exit(0); }
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
rl.on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') return send({ id:msg.id, result:{} });
  if (msg.method === 'thread/start') return send({ id:msg.id, result:{ thread:{ id:'thr_exit', ephemeral:true } } });
  if (msg.method === 'turn/start') {
    send({ id:msg.id, result:{ turn:{ id:'turn_exit', status:'inProgress', items:[] } } });
    setTimeout(() => process.exit(7), 5);
  }
});
`);
  chmodSync(file, 0o755);
  return file;
}

test('Codex app-server failure rejects notification waiters immediately and removes AbortSignal listeners', async () => {
  if (process.platform === 'win32') return;
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-fake-codex-exit-'));
  const command = createExitAfterTurnStartFakeCodex(dir);
  const client = new CodexAppServerClient({ command });
  const controller = new AbortController();
  let added = 0;
  let removed = 0;
  const signal = {
    get aborted() { return controller.signal.aborted; },
    addEventListener(type, listener, options) { added += 1; controller.signal.addEventListener(type, listener, options); },
    removeEventListener(type, listener, options) { removed += 1; controller.signal.removeEventListener(type, listener, options); },
  };
  try {
    await assert.rejects(client.runTurn({
      cwd:dir, writableRoots:[], prompt:'exit', inputItems:[], outputSchema:{type:'object'}, networkAccess:false, signal,
    }), /app-server exited/);
    assert.equal(added, 1);
    assert.equal(removed, 1, 'runTurn must remove its abort listener even when app-server exits');
    assert.equal(client.notificationWaiters.length, 0);
  } finally { client.close(); rmSync(dir,{recursive:true,force:true}); }
});

test('Codex client close proactively rejects a long-lived event waiter without leaving it pending', async () => {
  const client = new CodexAppServerClient({ command:'unused' });
  const waiting = client.waitFor(() => false, 60_000);
  assert.equal(client.notificationWaiters.length, 1);
  client.close();
  await assert.rejects(waiting, /app-server closed/);
  assert.equal(client.notificationWaiters.length, 0);
});

test('model refresh diagnostics identify the RPC that was active when Codex reported the child-exit timeout', async () => {
  if (process.platform === 'win32') return;
  const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-refresh-'));
  const command=join(dir,'codex-refresh.mjs');
  writeFileSync(command,`#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-fake 0.147.0'); process.exit(0); }
const rl=readline.createInterface({input:process.stdin});
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
rl.on('line',line=>{
  const msg=JSON.parse(line);
  if(msg.method==='initialize') return send({id:msg.id,result:{}});
  if(msg.method==='model/list') {
    process.stderr.write('failed to refresh available models: timeout waiting for child process to exit\\n');
    return setTimeout(()=>send({id:msg.id,result:{data:[]}}),10);
  }
});
`);
  chmodSync(command,0o755);
  const lines=[];
  const client=new CodexAppServerClient({command,diagnosticLogger:line=>lines.push(line)});
  try {
    await client.connect();
    await client.request('model/list',{},1_000);
    const events=lines.map(line=>JSON.parse(line.replace(/^\[codex-runtime\] /,'')));
    const refresh=events.find(item=>item.event==='model-refresh-error');
    assert.ok(refresh);
    assert.ok(refresh.activeRpcMethods.includes('model/list'));
    assert.ok(events.some(item=>item.event==='rpc-start'&&item.method==='model/list'));
    assert.ok(events.some(item=>item.event==='rpc-end'&&item.method==='model/list'&&item.ok===true));
  } finally { client.close(); rmSync(dir,{recursive:true,force:true}); }
});

function createLeaseFakeCodex(dir,{completeOnSteer=false}={}) {
  const file=join(dir,'codex-lease.mjs');
  writeFileSync(file,`#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-fake 0.147.0'); process.exit(0); }
const rl=readline.createInterface({input:process.stdin});
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
const completeOnSteer=${completeOnSteer?'true':'false'};
rl.on('line',line=>{
  const msg=JSON.parse(line);
  if(msg.method==='initialize') return send({id:msg.id,result:{}});
  if(msg.method==='thread/start') return send({id:msg.id,result:{thread:{id:'thr_lease',ephemeral:true}}});
  if(msg.method==='turn/start') return send({id:msg.id,result:{turn:{id:'turn_lease',status:'inProgress',items:[]}}});
  if(msg.method==='turn/steer') {
    if(msg.params?.threadId!=='thr_lease'||msg.params?.expectedTurnId!=='turn_lease') return send({id:msg.id,error:{code:-32602,message:'wrong steer ids'}});
    const text=msg.params?.input?.[0]?.text||'';
    if(!text.includes('STOP_AFTER_ENOUGH_EVIDENCE')) return send({id:msg.id,error:{code:-32602,message:'stopCondition missing from steer'}});
    send({id:msg.id,result:{turn:{id:'turn_lease'}}});
    if(completeOnSteer) setTimeout(()=>{
      send({method:'item/completed',params:{threadId:'thr_lease',turnId:'turn_lease',item:{type:'agentMessage',text:'{"kind":"complete","summary":"bounded"}'}}});
      send({method:'turn/completed',params:{threadId:'thr_lease',turn:{id:'turn_lease',status:'completed',items:[],error:null}}});
    },10);
    return;
  }
  if(msg.method==='turn/interrupt') {
    send({id:msg.id,result:{}});
    setTimeout(()=>send({method:'turn/completed',params:{threadId:'thr_lease',turn:{id:'turn_lease',status:'interrupted',items:[],error:null}}}),5);
  }
});
`);
  chmodSync(file,0o755);
  return file;
}

test('bounded Subagent steers once at the soft lease boundary and can finish in the same turn', async()=>{
  if(process.platform==='win32') return;
  const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-lease-steer-'));
  const command=createLeaseFakeCodex(dir,{completeOnSteer:true});
  const diagnostics=[];
  const client=new CodexAppServerClient({command,diagnosticLogger:line=>diagnostics.push(line),turnEventTimeoutMs:1_200,subagentExecutionWindowMs:1_200});
  try{
    const text=await client.runTurn({
      cwd:dir,writableRoots:[],prompt:'bounded subagent',inputItems:[],outputSchema:{type:'object'},networkAccess:false,
      stopCondition:'STOP_AFTER_ENOUGH_EVIDENCE',diagnosticContext:{role:'subagent',taskId:'T-LEASE',workUnitId:'WU-LEASE'},
    });
    assert.match(text,/bounded/);
    assert.equal(client.activeTurnCount,0);
    assert.equal(client.notificationWaiters.length,0);
    const events=diagnostics.map(line=>JSON.parse(line.replace(/^\[codex-runtime\] /,'')));
    assert.equal(events.filter(item=>item.event==='turn-steered').length,1);
    assert.equal(events.filter(item=>item.event==='turn-execution-boundary').length,0);
  }finally{client.close();rmSync(dir,{recursive:true,force:true});}
});

test('bounded Subagent is interrupted at the hard lease boundary and reports a non-retryable execution boundary', async()=>{
  if(process.platform==='win32') return;
  const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-lease-interrupt-'));
  const command=createLeaseFakeCodex(dir,{completeOnSteer:false});
  const diagnostics=[];
  const client=new CodexAppServerClient({command,diagnosticLogger:line=>diagnostics.push(line),turnEventTimeoutMs:1_200,subagentExecutionWindowMs:1_200});
  try{
    await assert.rejects(client.runTurn({
      cwd:dir,writableRoots:[],prompt:'unbounded subagent',inputItems:[],outputSchema:{type:'object'},networkAccess:false,
      stopCondition:'STOP_AFTER_ENOUGH_EVIDENCE',diagnosticContext:{role:'subagent',taskId:'T-LEASE',workUnitId:'WU-LEASE'},
    }),error=>Boolean(error?.executionBoundary&&error?.nonRetryable));
    assert.equal(client.activeTurnCount,0);
    assert.equal(client.notificationWaiters.length,0);
    const events=diagnostics.map(line=>JSON.parse(line.replace(/^\[codex-runtime\] /,'')));
    assert.equal(events.filter(item=>item.event==='turn-steered').length,1);
    const boundary=events.find(item=>item.event==='turn-execution-boundary');
    assert.ok(boundary);
    assert.equal(boundary.stopConditionBytes,Buffer.byteLength('STOP_AFTER_ENOUGH_EVIDENCE','utf8'));
    assert.equal(Object.hasOwn(boundary,'stopCondition'),false,'diagnostics must not persist Work Unit instruction text');
    assert.ok(diagnostics.every(line=>!line.includes('STOP_AFTER_ENOUGH_EVIDENCE')),'diagnostics must not leak the stop-condition body');
    assert.ok(events.some(item=>item.event==='turn-failed'));
    assert.ok(events.some(item=>item.event==='turn-released'&&item.activeTurnCount===0));
  }finally{client.close();rmSync(dir,{recursive:true,force:true});}
});
