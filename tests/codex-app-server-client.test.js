import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAppServerClient } from '../src/extensions/executors/codex/app-server-client.js';

function turnGrant(dir){return{permissionProfile:'taskboard_runtime',runtimeWorkspaceRoots:[dir]};}

function createFakeCodex(dir){
  const file=join(dir,'codex-fake.mjs');
  writeFileSync(file,`#!/usr/bin/env node
import readline from 'node:readline';
if(process.argv.includes('--version')){console.log('codex-fake 1.0');process.exit(0);}
const rl=readline.createInterface({input:process.stdin});const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
rl.on('line',line=>{const msg=JSON.parse(line);if(msg.method==='initialize')return send({id:msg.id,result:{userAgent:'fake'}});if(msg.method==='account/read')return send({id:msg.id,result:{account:{type:'chatgpt',planType:'plus'},requiresOpenaiAuth:true}});if(msg.method==='thread/start')return send({id:msg.id,result:{thread:{id:'thr_test',ephemeral:true},activePermissionProfile:{id:msg.params.permissions},runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[]}});if(msg.method==='turn/start'){send({id:msg.id,result:{turn:{id:'turn_test',status:'inProgress',items:[]}}});setTimeout(()=>{send({method:'item/completed',params:{threadId:'thr_test',turnId:'turn_test',item:{id:'msg_1',type:'agentMessage',text:'{"kind":"complete","summary":"ok"}'}}});send({method:'turn/completed',params:{threadId:'thr_test',turn:{id:'turn_test',status:'completed',items:[],error:null}}});},10);}});
`);chmodSync(file,0o755);return file;
}

test('Codex app-server reads final agentMessage and records one actual turn',async()=>{
  if(process.platform==='win32')return;const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-')),diagnostics=[],client=new CodexAppServerClient({command:createFakeCodex(dir),diagnosticLogger:line=>diagnostics.push(line)});
  try{const health=await client.health();assert.equal(health.connected,true);assert.equal(health.authenticated,true);const text=await client.runTurn({cwd:dir,writableRoots:[],prompt:'test',inputItems:[],outputSchema:{type:'object'},networkAccess:false,...turnGrant(dir)});assert.match(text,/"kind":"complete"/);assert.equal(client.activeTurnCount,0);const events=diagnostics.map(line=>JSON.parse(line.replace(/^\[codex-runtime\] /,'')));assert.ok(events.some(item=>item.event==='turn-started'&&item.activeTurnCount===1));assert.ok(events.some(item=>item.event==='turn-completed'));assert.ok(events.some(item=>item.event==='turn-released'&&item.activeTurnCount===0));assert.equal(events.some(item=>item.event==='turn-steered'||item.event==='turn-execution-boundary'),false);}finally{client.close();rmSync(dir,{recursive:true,force:true});}
});

test('turn accounting releases capacity even when execution-start callback throws',async()=>{
  if(process.platform==='win32')return;const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-callback-')),diagnostics=[],client=new CodexAppServerClient({command:createFakeCodex(dir),diagnosticLogger:line=>diagnostics.push(line)});
  try{await assert.rejects(client.runTurn({cwd:dir,writableRoots:[],prompt:'test',inputItems:[],outputSchema:{type:'object'},networkAccess:false,...turnGrant(dir),onExecutionStarted(){throw new Error('execution-start callback failed');}}),/execution-start callback failed/);assert.equal(client.activeTurnCount,0);const events=diagnostics.map(line=>JSON.parse(line.replace(/^\[codex-runtime\] /,'')));assert.ok(events.some(item=>item.event==='turn-failed'));assert.ok(events.some(item=>item.event==='turn-released'&&item.activeTurnCount===0));}finally{client.close();rmSync(dir,{recursive:true,force:true});}
});

function createPermissionStrictFakeCodex(dir){
  const file=join(dir,'codex-permission-strict.mjs');writeFileSync(file,`#!/usr/bin/env node
import readline from 'node:readline';
if(process.argv.includes('--version')){console.log('codex-fake current');process.exit(0);}const rl=readline.createInterface({input:process.stdin});const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
rl.on('line',line=>{const msg=JSON.parse(line);if(msg.method==='initialize'){if(msg.params?.capabilities?.experimentalApi!==true)return send({id:msg.id,error:{code:-32602,message:'experimentalApi required'}});return send({id:msg.id,result:{}});}if(msg.method==='thread/start'){if(msg.params?.permissions!=='taskboard_runtime')return send({id:msg.id,error:{code:-32602,message:'permission profile missing'}});if(!Array.isArray(msg.params?.runtimeWorkspaceRoots)||msg.params.runtimeWorkspaceRoots.length!==1)return send({id:msg.id,error:{code:-32602,message:'runtime roots missing'}});if(msg.params?.config?.permissions?.taskboard_runtime==null)return send({id:msg.id,error:{code:-32602,message:'profile config missing'}});return send({id:msg.id,result:{thread:{id:'thr_strict',ephemeral:true},activePermissionProfile:{id:msg.params.permissions},runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots}});}if(msg.method==='turn/start'){if('sandboxPolicy' in msg.params)return send({id:msg.id,error:{code:-32602,message:'legacy sandbox must not be combined with permissions'}});if(msg.params?.effort!=='high')return send({id:msg.id,error:{code:-32602,message:'missing expected effort override'}});send({id:msg.id,result:{turn:{id:'turn_strict',status:'inProgress',items:[]}}});setTimeout(()=>{send({method:'item/completed',params:{threadId:'thr_strict',turnId:'turn_strict',item:{type:'agentMessage',text:'{"kind":"complete"}'}}});send({method:'turn/completed',params:{threadId:'thr_strict',turn:{id:'turn_strict',status:'completed',items:[],error:null}}});},5);}});
`);chmodSync(file,0o755);return file;
}

test('app-server applies permission profile and exact runtime roots without legacy sandboxPolicy',async()=>{
  if(process.platform==='win32')return;const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-permissions-')),client=new CodexAppServerClient({command:createPermissionStrictFakeCodex(dir)});
  try{const text=await client.runTurn({cwd:dir,writableRoots:[],prompt:'test',inputItems:[],outputSchema:{type:'object'},reasoningEffort:'high',networkAccess:false,...turnGrant(dir),runtimeConfig:{permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':'read'}},network:{enabled:false}}}}});assert.match(text,/"kind":"complete"/);}finally{client.close();rmSync(dir,{recursive:true,force:true});}
});

function createPermissionIgnoringFakeCodex(dir){const file=join(dir,'codex-permission-ignore.mjs');writeFileSync(file,`#!/usr/bin/env node
import readline from 'node:readline';
if(process.argv.includes('--version')){console.log('codex-fake legacy');process.exit(0);}const rl=readline.createInterface({input:process.stdin});const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');rl.on('line',line=>{const msg=JSON.parse(line);if(msg.method==='initialize')return send({id:msg.id,result:{}});if(msg.method==='thread/start')return send({id:msg.id,result:{thread:{id:'legacy',ephemeral:true}}});});
`);chmodSync(file,0o755);return file;}

test('app-server that cannot confirm the permission profile fails closed',async()=>{if(process.platform==='win32')return;const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-permission-ignore-')),client=new CodexAppServerClient({command:createPermissionIgnoringFakeCodex(dir)});try{await assert.rejects(client.runTurn({cwd:dir,writableRoots:[],prompt:'test',inputItems:[],outputSchema:{type:'object'},networkAccess:false,...turnGrant(dir)}),/CODEX_PERMISSION_PROFILE_NOT_APPLIED/);}finally{client.close();rmSync(dir,{recursive:true,force:true});}});

function createInterruptFakeCodex(dir){const file=join(dir,'codex-interrupt.mjs');writeFileSync(file,`#!/usr/bin/env node
import readline from 'node:readline';
if(process.argv.includes('--version')){console.log('codex-fake 0.147.0');process.exit(0);}const rl=readline.createInterface({input:process.stdin});const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');rl.on('line',line=>{const msg=JSON.parse(line);if(msg.method==='initialize')return send({id:msg.id,result:{}});if(msg.method==='thread/start')return send({id:msg.id,result:{thread:{id:'thr_interrupt',ephemeral:true},activePermissionProfile:{id:msg.params.permissions},runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[]}});if(msg.method==='turn/start')return send({id:msg.id,result:{turn:{id:'turn_interrupt',status:'inProgress',items:[]}}});if(msg.method==='turn/interrupt'){send({id:msg.id,result:{}});setTimeout(()=>send({method:'turn/completed',params:{threadId:'thr_interrupt',turn:{id:'turn_interrupt',status:'interrupted',items:[],error:null}}}),5);}});
`);chmodSync(file,0o755);return file;}

test('cancellation interrupts the active turn',async()=>{if(process.platform==='win32')return;const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-interrupt-')),client=new CodexAppServerClient({command:createInterruptFakeCodex(dir)}),controller=new AbortController();try{const running=client.runTurn({cwd:dir,writableRoots:[],prompt:'long task',inputItems:[],outputSchema:{type:'object'},networkAccess:false,...turnGrant(dir),signal:controller.signal});setTimeout(()=>controller.abort(),40);await assert.rejects(running,error=>Boolean(error?.interrupted));}finally{client.close();rmSync(dir,{recursive:true,force:true});}});

function createExitAfterTurnStartFakeCodex(dir){const file=join(dir,'codex-exit.mjs');writeFileSync(file,`#!/usr/bin/env node
import readline from 'node:readline';
if(process.argv.includes('--version')){console.log('codex-fake 1.0');process.exit(0);}const rl=readline.createInterface({input:process.stdin});const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');rl.on('line',line=>{const msg=JSON.parse(line);if(msg.method==='initialize')return send({id:msg.id,result:{}});if(msg.method==='thread/start')return send({id:msg.id,result:{thread:{id:'thr_exit',ephemeral:true},activePermissionProfile:{id:msg.params.permissions},runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[]}});if(msg.method==='turn/start'){send({id:msg.id,result:{turn:{id:'turn_exit',status:'inProgress',items:[]}}});setTimeout(()=>process.exit(7),5);}});
`);chmodSync(file,0o755);return file;}

test('app-server failure rejects waiters and removes AbortSignal listener',async()=>{if(process.platform==='win32')return;const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-exit-')),client=new CodexAppServerClient({command:createExitAfterTurnStartFakeCodex(dir)}),controller=new AbortController();let added=0,removed=0;const signal={get aborted(){return controller.signal.aborted;},addEventListener(type,listener,options){added+=1;controller.signal.addEventListener(type,listener,options);},removeEventListener(type,listener,options){removed+=1;controller.signal.removeEventListener(type,listener,options);}};try{await assert.rejects(client.runTurn({cwd:dir,writableRoots:[],prompt:'exit',inputItems:[],outputSchema:{type:'object'},networkAccess:false,...turnGrant(dir),signal}),/app-server exited/);assert.equal(added,1);assert.equal(removed,1);assert.equal(client.notificationWaiters.length,0);}finally{client.close();rmSync(dir,{recursive:true,force:true});}});

test('client close rejects a long-lived event waiter',async()=>{const client=new CodexAppServerClient({command:'unused'}),waiting=client.waitFor(()=>false,60_000);assert.equal(client.notificationWaiters.length,1);client.close();await assert.rejects(waiting,/app-server closed/);assert.equal(client.notificationWaiters.length,0);});

test('model refresh diagnostics identify the active RPC',async()=>{
  if(process.platform==='win32')return;const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-refresh-')),command=join(dir,'codex-refresh.mjs');writeFileSync(command,`#!/usr/bin/env node
import readline from 'node:readline';
if(process.argv.includes('--version')){console.log('codex-fake 0.147.0');process.exit(0);}const rl=readline.createInterface({input:process.stdin});const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');rl.on('line',line=>{const msg=JSON.parse(line);if(msg.method==='initialize')return send({id:msg.id,result:{}});if(msg.method==='model/list'){process.stderr.write('failed to refresh available models: timeout waiting for child process to exit\\n');return setTimeout(()=>send({id:msg.id,result:{data:[]}}),10);}});
`);chmodSync(command,0o755);const lines=[],client=new CodexAppServerClient({command,diagnosticLogger:line=>lines.push(line),logLevel:'debug'});try{await client.connect();await client.request('model/list',{},1_000);const events=lines.map(line=>JSON.parse(line.replace(/^\[codex-runtime\] /,''))),refresh=events.find(item=>item.event==='model-refresh-error');assert.ok(refresh);assert.ok(refresh.activeRpcMethods.includes('model/list'));assert.ok(events.some(item=>item.event==='rpc-start'&&item.method==='model/list'));assert.ok(events.some(item=>item.event==='rpc-end'&&item.method==='model/list'&&item.ok===true));}finally{client.close();rmSync(dir,{recursive:true,force:true});}
});
