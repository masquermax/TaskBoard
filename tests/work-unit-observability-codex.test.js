import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { finalizeWorkUnitObservability } from '../src/core/work-unit-observability.js';
import { CodexAppServerClient } from '../src/extensions/executors/codex/app-server-client.js';

function createToolFakeCodex(dir){
  const file=join(dir,'codex-tool-observability.mjs');
  writeFileSync(file,`#!/usr/bin/env node
import readline from 'node:readline';
if(process.argv.includes('--version')){console.log('codex-fake 1.0');process.exit(0);}
const rl=readline.createInterface({input:process.stdin});const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
rl.on('line',line=>{const msg=JSON.parse(line);if(msg.method==='initialize')return send({id:msg.id,result:{}});if(msg.method==='thread/start')return send({id:msg.id,result:{thread:{id:'thr_obs',ephemeral:true},activePermissionProfile:{id:msg.params.permissions},runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[]}});if(msg.method==='turn/start'){send({id:msg.id,result:{turn:{id:'turn_obs',status:'inProgress',items:[]}}});setTimeout(()=>{send({method:'item/started',params:{threadId:'thr_obs',turnId:'turn_obs',item:{id:'cmd_1',type:'commandExecution',command:'rg "Authority" src/core',cwd:'${dir.replace(/\\/g,'\\\\')}',status:'inProgress'}}});send({method:'item/completed',params:{threadId:'thr_obs',turnId:'turn_obs',item:{id:'cmd_1',type:'commandExecution',command:'rg "Authority" src/core',cwd:'${dir.replace(/\\/g,'\\\\')}',status:'completed',exitCode:0,aggregatedOutput:'match'}}});send({method:'item/completed',params:{threadId:'thr_obs',turnId:'turn_obs',item:{id:'msg_1',type:'agentMessage',text:'{"delegationId":"authority-evidence","result":"ok","evidence":[],"blocker":null}'}}});send({method:'turn/completed',params:{threadId:'thr_obs',turn:{id:'turn_obs',status:'completed',items:[],error:null}}});},10);}});
`);chmodSync(file,0o755);return file;
}
function parseDiagnostics(lines){return lines.map(line=>JSON.parse(line.replace(/^\[codex-runtime\] /,'')));}

test('Codex binds factual tool timing to workUnitId without a role channel',async()=>{
  if(process.platform==='win32')return;
  const dir=mkdtempSync(join(tmpdir(),'taskboard-work-observability-')),diagnostics=[],client=new CodexAppServerClient({command:createToolFakeCodex(dir),logLevel:'debug',diagnosticLogger:line=>diagnostics.push(line)});
  try{
    const text=await client.runTurn({cwd:dir,prompt:'observe',inputItems:[],outputSchema:{type:'object'},permissionProfile:'taskboard_runtime',runtimeWorkspaceRoots:[dir],runtimeConfig:{permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':'read'}},network:{enabled:false}}}},diagnosticContext:{taskId:'T-0009',workUnitId:'authority-evidence'}});
    assert.match(text,/authority-evidence/);
    let events=parseDiagnostics(diagnostics),tool=events.find(item=>item.event==='tool-completed');
    assert.ok(tool);assert.equal(tool.toolType,'commandExecution');assert.equal(tool.success,true);assert.ok(tool.resultBytes>0);assert.equal('operationClass' in tool,false);assert.equal(events.some(item=>item.event==='work-unit-summary'),false);
    finalizeWorkUnitObservability({taskId:'T-0009',workUnitId:'authority-evidence',evidence:[{id:'E-1'}],status:'completed'});
    events=parseDiagnostics(diagnostics);const summary=events.find(item=>item.event==='work-unit-summary');assert.ok(summary);assert.equal(summary.toolCallCount,1);assert.equal(summary.evidenceCount,1);assert.equal('operationCounts' in summary,false);assert.equal('postSaturationCalls' in summary,false);
  }finally{client.close();rmSync(dir,{recursive:true,force:true});}
});
