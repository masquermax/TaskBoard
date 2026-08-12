import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrap } from '../src/server/bootstrap.js';

function createFakeCodex(dir) {
  const file = join(dir, 'codex-fake.mjs');
  writeFileSync(file, `#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-fake 1.0'); process.exit(0); }
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\n');
let turnNo = 0;
rl.on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') return send({ id:msg.id, result:{} });
  if (msg.method === 'account/read') return send({ id:msg.id, result:{ account:{ type:'chatgpt', planType:'plus' }, requiresOpenaiAuth:true } });
  if (msg.method === 'config/read') return send({ id:msg.id, result:{ config:{ model:'model-test', model_reasoning_effort:'medium' } } });
  if (msg.method === 'model/list') return send({ id:msg.id, result:{ data:[{ id:'model-test', supportedReasoningEfforts:[{effort:'low'},{effort:'medium'},{effort:'high'}] }] } });
  if (msg.method === 'modelProvider/capabilities/read') return send({ id:msg.id, result:{} });
  if (msg.method === 'thread/start') return send({ id:msg.id, result:{ thread:{ id:'thr_' + (turnNo + 1), ephemeral:true } } });
  if (msg.method === 'turn/start') {
    if (!['workspace-write','read-only'].includes(msg.params?.sandboxPolicy?.type)) return send({ id:msg.id, error:{ code:-32600, message:'Invalid sandbox policy' } });
    turnNo += 1;
    const threadId = msg.params.threadId;
    const turnId = 'turn_' + turnNo;
    send({ id:msg.id, result:{ turn:{ id:turnId, status:'inProgress', items:[] } } });
    const prompt = msg.params.input?.[0]?.text || '';
    if (prompt.includes('Semantic proof obligation:')) {
      const payload={reviews:[{id:'C-1',verdict:'supported',reason:'fake source proof supports the test claim'},{id:'gap_resolution:G-1',verdict:'supported',reason:'the answer explicitly supplies the requested scope'}]};
      return setTimeout(() => {
        send({ method:'item/completed', params:{ threadId, turnId, item:{ id:'agent_' + turnNo, type:'agentMessage', text:JSON.stringify(payload) } } });
        send({ method:'turn/completed', params:{ threadId, turn:{ id:turnId, status:'completed', items:[], error:null } } });
      }, 5);
    }
    const answered = prompt.includes('基础办公');
    const payload = answered
      ? { kind:'complete', summary:'完成', stageResult:'本次 OA 范围为基础办公', progressCommits:[{title:'需求范围已确认',detail:'本次 OA 范围为基础办公',sourceIds:['C-1']}], finalResult:null, resultMode:'analysis', evidence:[{id:'E-1',strength:'direct',kind:'requirement',sourceType:'human',coverage:'system',statement:'基础办公',basis:'Human Gateway 回答：基础办公',locator:'Human Gateway answer',observation:'基础办公'}], claims:[{id:'C-1',statement:'本次 OA 范围为基础办公',level:'confirmed',evidenceIds:['E-1'],scope:'single_system',coverage:'system',hops:[]}], gaps:[], recommendations:[], steps:[{order:1,text:'本次 OA 范围为基础办公',kind:'confirmed',sourceIds:['C-1']}], gapResolutions:[{gapId:'G-1',reason:'用户已确认范围为基础办公',evidenceIds:['E-1']}], gateway:null, delegations:[] }
      : { kind:'human_gateway', summary:'需要范围', stageResult:null, progressCommits:[], finalResult:null, resultMode:'analysis', evidence:[], claims:[], gaps:[{id:'G-1',question:'OA 核心范围？',reason:'范围会改变结果且当前材料没有答案',kind:'business_decision',blocking:true,evidenceIds:[]}], recommendations:[], steps:[], gapResolutions:[], gateway:{ gapId:'G-1', question:'OA 核心范围？', context:'范围会改变结果', options:['基础办公'] }, delegations:[] };
    setTimeout(() => {
      send({ method:'item/completed', params:{ threadId, turnId, item:{ id:'agent_' + turnNo, type:'agentMessage', text:JSON.stringify(payload) } } });
      send({ method:'turn/completed', params:{ threadId, turn:{ id:turnId, status:'completed', items:[], error:null } } });
    }, 5);
  }
});
`);
  chmodSync(file, 0o755);
  return file;
}

test('Codex-backed full flow reaches Human Gateway and resumes to completion', async () => {
  if (process.platform === 'win32') return;
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-codex-flow-'));
  const fake = createFakeCodex(dir);
  const old = process.env.CODEX_COMMAND;
  process.env.CODEX_COMMAND = fake;
  const projectDir = join(dir, 'oa-project');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(projectDir);
  const runtime = bootstrap({ rootDir:dir, executorName:'codex', startScheduler:false });
  try {
    const health = await runtime.executor.health();
    assert.equal(health.connected, true);
    assert.equal(health.authenticated, true);

    const project = runtime.taskService.createProject({ name:'OA', path:projectDir });
    const task = runtime.scheduler.createTask({ title:'OA 需求分析', instruction:'根据项目分析本次 OA 需要覆盖的业务范围', projectId:project.id });
    await runtime.scheduler.tick();
    assert.equal(runtime.taskService.getTask(task.id).status, 'WAITING_HUMAN');
    runtime.scheduler.answerHumanGateway(task.id, '基础办公');
    await runtime.scheduler.tick();
    const completed = runtime.taskService.getTask(task.id);
    assert.equal(completed.status, 'COMPLETED');
    assert.match(completed.final_result, /基础办公/);
    assert.match(completed.final_result, /1\. 本次 OA 范围为基础办公/);
    assert.doesNotMatch(completed.final_result, /【其他已确认】[\s\S]*本次 OA 范围为基础办公/);
  } finally {
    runtime.executor.close();
    runtime.database.close();
    if (old == null) delete process.env.CODEX_COMMAND; else process.env.CODEX_COMMAND = old;
    rmSync(dir, { recursive:true, force:true });
  }
});
