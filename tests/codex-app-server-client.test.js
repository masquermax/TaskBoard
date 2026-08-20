import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAppServerClient } from '../src/extensions/executors/codex/app-server-client.js';

function grant(dir){return{permissionProfile:'taskboard_runtime',runtimeWorkspaceRoots:[dir],runtimeConfig:{permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':'read'}},network:{enabled:false}}}}};}
function writeExecutable(path,body){writeFileSync(path,`#!/usr/bin/env node\n${body}`);chmodSync(path,0o755);return path;}
function normalFake(dir){return writeExecutable(join(dir,'codex-normal.mjs'),`
import readline from 'node:readline';
if(process.argv.includes('--version')){console.log('codex-fake 1.0');process.exit(0);}
const rl=readline.createInterface({input:process.stdin});const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');
rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')return send({id:m.id,result:{}});if(m.method==='account/read')return send({id:m.id,result:{account:{type:'chatgpt'},requiresOpenaiAuth:true}});if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'thr',ephemeral:true},activePermissionProfile:{id:m.params.permissions},runtimeWorkspaceRoots:m.params.runtimeWorkspaceRoots||[]}});if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'turn',status:'inProgress',items:[]}}});setTimeout(()=>{send({method:'item/completed',params:{threadId:'thr',turnId:'turn',item:{id:'msg',type:'agentMessage',text:'{"kind":"complete"}'}}});send({method:'turn/completed',params:{threadId:'thr',turn:{id:'turn',status:'completed',items:[],error:null}}});},5);}});
`);}

test('Codex client consumes item/completed as the final agent message and releases the turn',async()=>{
  if(process.platform==='win32')return;const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-normal-')),diagnostics=[],client=new CodexAppServerClient({command:normalFake(dir),logLevel:'debug',diagnosticLogger:line=>diagnostics.push(line)});
  try{const text=await client.runTurn({cwd:dir,prompt:'test',inputItems:[],outputSchema:{type:'object'},networkAccess:false,...grant(dir)});assert.match(text,/"kind":"complete"/);assert.equal(client.activeTurnCount,0);const events=diagnostics.map(line=>JSON.parse(line.replace(/^\[codex-runtime\] /,'')));assert.ok(events.some(x=>x.event==='turn-started'));assert.ok(events.some(x=>x.event==='turn-released'&&x.activeTurnCount===0));}finally{client.close();rmSync(dir,{recursive:true,force:true});}
});

test('Codex client fails closed when app-server does not confirm the requested permission profile',async()=>{
  if(process.platform==='win32')return;const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-permission-')),command=writeExecutable(join(dir,'codex-ignore.mjs'),`
import readline from 'node:readline';if(process.argv.includes('--version')){console.log('codex-fake');process.exit(0);}const rl=readline.createInterface({input:process.stdin});const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')return send({id:m.id,result:{}});if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'thr',ephemeral:true},runtimeWorkspaceRoots:m.params.runtimeWorkspaceRoots||[]}});});
`),client=new CodexAppServerClient({command});
  try{await assert.rejects(client.runTurn({cwd:dir,prompt:'test',inputItems:[],outputSchema:{type:'object'},networkAccess:false,...grant(dir)}),/CODEX_PERMISSION_PROFILE_NOT_APPLIED/);}finally{client.close();rmSync(dir,{recursive:true,force:true});}
});

test('Codex client fails closed when app-server does not confirm the exact runtime roots',async()=>{
  if(process.platform==='win32')return;const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-roots-')),command=writeExecutable(join(dir,'codex-roots.mjs'),`
import readline from 'node:readline';if(process.argv.includes('--version')){console.log('codex-fake');process.exit(0);}const rl=readline.createInterface({input:process.stdin});const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')return send({id:m.id,result:{}});if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'thr',ephemeral:true},activePermissionProfile:{id:m.params.permissions},runtimeWorkspaceRoots:[]}});});
`),client=new CodexAppServerClient({command});
  try{await assert.rejects(client.runTurn({cwd:dir,prompt:'test',inputItems:[],outputSchema:{type:'object'},networkAccess:false,...grant(dir)}),/CODEX_RUNTIME_ROOTS_NOT_APPLIED/);}finally{client.close();rmSync(dir,{recursive:true,force:true});}
});

function interruptFake(dir){return writeExecutable(join(dir,'codex-interrupt.mjs'),`
import readline from 'node:readline';if(process.argv.includes('--version')){console.log('codex-fake');process.exit(0);}const rl=readline.createInterface({input:process.stdin});const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')return send({id:m.id,result:{}});if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'thr',ephemeral:true},activePermissionProfile:{id:m.params.permissions},runtimeWorkspaceRoots:m.params.runtimeWorkspaceRoots||[]}});if(m.method==='turn/start')return send({id:m.id,result:{turn:{id:'turn',status:'inProgress',items:[]}}});if(m.method==='turn/interrupt'){send({id:m.id,result:{}});setTimeout(()=>send({method:'turn/completed',params:{threadId:'thr',turn:{id:'turn',status:'interrupted',items:[],error:null}}}),5);}});
`);}

test('cancellation interrupts the active Codex turn and releases local accounting',async()=>{
  if(process.platform==='win32')return;const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-interrupt-')),client=new CodexAppServerClient({command:interruptFake(dir)}),controller=new AbortController();
  try{const running=client.runTurn({cwd:dir,prompt:'long',inputItems:[],outputSchema:{type:'object'},networkAccess:false,...grant(dir),signal:controller.signal});setTimeout(()=>controller.abort(),30);await assert.rejects(running,error=>Boolean(error?.interrupted));assert.equal(client.activeTurnCount,0);}finally{client.close();rmSync(dir,{recursive:true,force:true});}
});

test('app-server process failure rejects the active turn instead of waiting for the event timeout',async()=>{
  if(process.platform==='win32')return;const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-exit-')),command=writeExecutable(join(dir,'codex-exit.mjs'),`
import readline from 'node:readline';if(process.argv.includes('--version')){console.log('codex-fake');process.exit(0);}const rl=readline.createInterface({input:process.stdin});const send=v=>process.stdout.write(JSON.stringify(v)+'\\n');rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')return send({id:m.id,result:{}});if(m.method==='thread/start')return send({id:m.id,result:{thread:{id:'thr',ephemeral:true},activePermissionProfile:{id:m.params.permissions},runtimeWorkspaceRoots:m.params.runtimeWorkspaceRoots||[]}});if(m.method==='turn/start'){send({id:m.id,result:{turn:{id:'turn',status:'inProgress',items:[]}}});setTimeout(()=>process.exit(7),5);}});
`),client=new CodexAppServerClient({command,turnEventTimeoutMs:60_000});
  try{await assert.rejects(client.runTurn({cwd:dir,prompt:'exit',inputItems:[],outputSchema:{type:'object'},networkAccess:false,...grant(dir)}),/app-server exited/);assert.equal(client.notificationWaiters.length,0);assert.equal(client.activeTurnCount,0);}finally{client.close();rmSync(dir,{recursive:true,force:true});}
});

test('client close rejects a long-lived event waiter immediately',async()=>{const client=new CodexAppServerClient({command:'unused'}),waiting=client.waitFor(()=>false,60_000);assert.equal(client.notificationWaiters.length,1);client.close();await assert.rejects(waiting,/app-server closed/);assert.equal(client.notificationWaiters.length,0);});
