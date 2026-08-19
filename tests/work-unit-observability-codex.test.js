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
const rl=readline.createInterface({input:process.stdin});
const send=value=>process.stdout.write(JSON.stringify(value)+'\\n');
rl.on('line',line=>{
  const msg=JSON.parse(line);
  if(msg.method==='initialize')return send({id:msg.id,result:{}});
  if(msg.method==='thread/start')return send({id:msg.id,result:{thread:{id:'thr_obs',ephemeral:true},activePermissionProfile:{id:msg.params.permissions},runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[]}});
  if(msg.method==='turn/start'){
    send({id:msg.id,result:{turn:{id:'turn_obs',status:'inProgress',items:[]}}});
    setTimeout(()=>{
      send({method:'item/started',params:{threadId:'thr_obs',turnId:'turn_obs',item:{id:'cmd_1',type:'commandExecution',command:'rg "Authority" src/core',status:'inProgress'}}});
      send({method:'item/completed',params:{threadId:'thr_obs',turnId:'turn_obs',item:{id:'cmd_1',type:'commandExecution',command:'rg "Authority" src/core',status:'completed',exitCode:0,aggregatedOutput:'src/core/root-runtime.js:10: Authority owner is GovernanceCompiler.'}}});
      send({method:'item/completed',params:{threadId:'thr_obs',turnId:'turn_obs',item:{id:'msg_1',type:'agentMessage',text:'{"delegationId":"authority-evidence","result":"ok","evidence":[],"findings":[],"discoveries":[],"blocker":null,"uncertainty":null}'}}});
      send({method:'turn/completed',params:{threadId:'thr_obs',turn:{id:'turn_obs',status:'completed',items:[],error:null}}});
    },10);
  }
});
`);
  chmodSync(file,0o755);
  return file;
}

function parseDiagnostics(lines){return lines.map(line=>JSON.parse(line.replace(/^\[codex-runtime\] /,'')));}

test('Codex item completion streams tool diagnostics before verified Evidence finalizes the Work Unit',async()=>{
  if(process.platform==='win32')return; // executable shebang fixture is POSIX-only
  const dir=mkdtempSync(join(tmpdir(),'taskboard-work-observability-'));
  const diagnostics=[];
  const client=new CodexAppServerClient({command:createToolFakeCodex(dir),logLevel:'debug',diagnosticLogger:line=>diagnostics.push(line),subagentExecutionWindowMs:30_000});
  try{
    const text=await client.runTurn({
      cwd:dir,
      prompt:'observe',
      inputItems:[],
      outputSchema:{type:'object'},
      permissionProfile:'taskboard_runtime',
      runtimeWorkspaceRoots:[dir],
      runtimeConfig:{permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':'read'}},network:{enabled:false}}}},
      diagnosticContext:{taskId:'T-0009',workUnitId:'authority-evidence',role:'subagent'},
      stopCondition:'1. identify authority owner\n2. cite source',
    });
    assert.match(text,/authority-evidence/);

    let events=parseDiagnostics(diagnostics);
    const tool=events.find(item=>item.event==='tool-completed');
    assert.ok(tool,'tool-completed must be emitted by the canonical item/completed stream');
    assert.equal(tool.taskId,'T-0009');
    assert.equal(tool.workUnitId,'authority-evidence');
    assert.equal(tool.turnId,'turn_obs');
    assert.equal(tool.seq,1);
    assert.equal(tool.toolCallName,'rg');
    assert.equal(tool.toolType,'commandExecution');
    assert.equal(tool.operationClass,'search');
    assert.equal(tool.success,true);
    assert.ok(tool.resultBytes>0);
    assert.equal(tool.newEvidenceCount,null);
    assert.equal(tool.elapsedSinceLastNewEvidenceMs,null);
    assert.equal(tool.evidenceState,'pending-verification');
    assert.equal(events.some(item=>item.event==='work-unit-summary'),false,'transport must not invent verified Evidence or completion metrics');

    finalizeWorkUnitObservability({
      taskId:'T-0009',
      workUnitId:'authority-evidence',
      evidence:[{id:'E-1',locator:'src/core/root-runtime.js',observation:'Authority owner is GovernanceCompiler.'}],
      status:'completed',
    });
    events=parseDiagnostics(diagnostics);
    const summary=events.find(item=>item.event==='work-unit-summary');
    assert.ok(summary);
    assert.equal(summary.toolCallCount,1);
    assert.equal(summary.uniqueToolCalls,1);
    assert.equal(summary.newEvidenceCount,1);
    assert.equal(summary.attributedEvidenceCount,1);
    assert.equal(summary.stopConditionProgress.satisfied,null);
    assert.equal(summary.stopConditionProgress.status,'unknown');
    assert.ok(events.some(item=>item.event==='tool-evidence-attributed'&&item.seq===1&&item.newEvidenceCount===1));
  }finally{
    client.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
