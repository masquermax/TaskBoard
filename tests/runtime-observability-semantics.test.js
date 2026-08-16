import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { loadEmbeddedTaskboardUi } from '../src/extensions/surfaces/cdp/embedded-ui-bundle.js';

function delegation(id='audit') {
  return {
    id,
    title:'审计工作',
    goal:'取得可验证证据',
    expectedOutput:'返回证据结论',
    stopCondition:'证据足够后停止',
    projectAccess:'none',
    networkAccess:false,
    skillId:null,
    dependsOn:[],
    inputRefs:[],
  };
}

function task(id='T-OBS') {
  return { id, title:'可观测性验证', instruction:'验证 Runtime 投影', projectScopes:[], attachments:[], references:[], workReceipts:[], analysisState:null, last_stage_result:null };
}

test('Work Unit keeps issued/start/completion timestamps separate from last activity', async()=>{
  const executor={
    async runRoot(){ throw new Error('unused'); },
    async runSubagent({delegation:onWork,onExecutionStarted,onProgress}){
      onExecutionStarted?.();
      onProgress?.({summary:'正在核对证据',detail:'已经取得一条证据，继续判断。'});
      await new Promise(resolve=>setTimeout(resolve,5));
      return {delegationId:onWork.id,result:'审计完成。',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};
    },
  };
  const router=new ModelRouter();
  const root=new RootRuntime({executor,modelRouter:router,subagentRuntime:new SubagentRuntime({executor,modelRouter:router}),maxConcurrentSubagents:1});
  const currentTask=task();
  const session=root.createSession(currentTask);
  const stage=root.createStage(session,[delegation()]);
  const unit=stage.workUnits[0];

  assert.ok(unit.issuedAt,'Work Unit issuance must have a stable timestamp');
  assert.equal(unit.startedAt,null,'issuance is not execution start');
  assert.equal(unit.completedAt,null);

  const issuedAt=unit.issuedAt;
  const outcome=await root.runStage(currentTask,session,{});
  assert.equal(outcome.kind,'work_results_ready','a completed Subagent result must return to Root before the stage is cleared');
  const completed=root.makeSnapshot(session).stage.workUnits[0];
  assert.equal(completed.status,'COMPLETED');
  assert.equal(completed.issuedAt,issuedAt,'progress updates must never rewrite issuance time');
  assert.ok(completed.startedAt,'first real Subagent admission must be recorded');
  assert.ok(completed.completedAt,'completion must have its own timestamp');
  assert.ok(new Date(completed.updatedAt).getTime()>=new Date(completed.startedAt).getTime());
  assert.equal(completed.updatedAt,completed.completedAt,'a completed Work Unit last activity is its completion event');
});

test('Root turn keeps the semantic activity title instead of collapsing every turn to 综合分析', async()=>{
  const snapshots=[];
  const executor={
    async runRoot({onExecutionStarted,onProgress}){
      onExecutionStarted?.();
      onProgress?.({summary:'Codex 正在执行',detail:'模型正在进行 Task 级判断。'});
      return {kind:'complete',summary:'完成',stageResult:null,finalResult:'完成',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],delegations:[],gateway:null,gapResolutions:[]};
    },
    async runSubagent(){ throw new Error('unused'); },
  };
  const router=new ModelRouter();
  const root=new RootRuntime({executor,modelRouter:router,subagentRuntime:new SubagentRuntime({executor,modelRouter:router})});
  const currentTask=task('T-ROOT-OBS');
  const session=root.createSession(currentTask);

  await root.runRootTurn(currentTask,session,{onProgress:snapshot=>snapshots.push(snapshot),onExecutionStarted(){}},{activityKind:'initial'});

  assert.ok(snapshots.some(snapshot=>snapshot.actor?.title==='Root 初始判断'));
  assert.equal(snapshots.at(-1)?.actor?.title,'Root 初始判断');
});

test('UI distinguishes certified conclusions from runtime execution progress',()=>{
  const html=readFileSync(new URL('../src/ui/index.html',import.meta.url),'utf8');
  assert.match(html,/已确认结论/);
  assert.match(html,/已通过认证并进入当前 Task 认知/);
  assert.doesNotMatch(html,/已确认进展/);
});

test('the Codex embedded surface can bundle the shared Work timing projection',()=>{
  const uiRoot=fileURLToPath(new URL('../src/ui/',import.meta.url));
  const bundle=loadEmbeddedTaskboardUi(uiRoot);
  assert.match(bundle.appExpression,/function formatWorkTiming\s*\(/);
  assert.match(bundle.appExpression,/const formatPhaseTime=formatTaskTime/);
  assert.doesNotMatch(bundle.appExpression,/^\s*(?:import|export)\s/m);
});

test('embedded time bundling preserves named imports and aliases instead of one hard-coded import shape',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-embedded-time-'));
  try{
    writeFileSync(join(dir,'index.html'),'<body><script src="/app.js"></script><script src="/connection-settings.js"></script></body>');
    writeFileSync(join(dir,'app.css'),'');
    writeFileSync(join(dir,'time.js'),[
      "export function formatTaskTime(){return 'task';}",
      "export function formatElapsedTime(){return 'elapsed';}",
      "export function formatWorkTiming(){return 'work';}",
    ].join('\n'));
    writeFileSync(join(dir,'app.js'),"import { formatElapsedTime as elapsed, formatWorkTiming } from './time.js';\nglobalThis.__timeBundle=[elapsed(),formatWorkTiming()];");
    writeFileSync(join(dir,'connection-settings.js'),'globalThis.__connectionBundle=true;');

    const bundle=loadEmbeddedTaskboardUi(dir);
    assert.match(bundle.appExpression,/const elapsed=formatElapsedTime;/);
    assert.match(bundle.appExpression,/function formatWorkTiming\s*\(/);
    assert.doesNotMatch(bundle.appExpression,/^\s*(?:import|export)\s/m);
  }finally{
    rmSync(dir,{recursive:true,force:true});
  }
});
