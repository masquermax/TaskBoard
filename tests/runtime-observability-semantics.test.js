import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';

function delegation(id='audit'){return{id,title:'审计工作',goal:'取得可验证证据',expectedOutput:'返回执行结果和来源',stopCondition:'Root 指定的结果已经返回',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};}
function task(id='T-OBS'){return{id,title:'可观测性验证',instruction:'验证 Runtime 投影',projectScopes:[],attachments:[],references:[],workReceipts:[],analysisState:null};}

test('Work Unit keeps issued/start/completion timestamps separate from last activity',async()=>{
  const executor={async runRoot(){throw new Error('unused');},async runSubagent({delegation:onWork,onExecutionStarted,onProgress}){onExecutionStarted?.();onProgress?.({summary:'正在执行',detail:'正在完成 Root 指定的 Work Unit。'});await new Promise(resolve=>setTimeout(resolve,5));return{delegationId:onWork.id,result:'审计完成。',evidence:[],blocker:null};}},router=new ModelRouter(),root=new RootRuntime({executor,modelRouter:router,subagentRuntime:new SubagentRuntime({executor,modelRouter:router}),maxConcurrentSubagents:1}),currentTask=task(),session=root.createSession(currentTask),stage=root.createStage(session,[delegation()]),unit=stage.workUnits[0];
  assert.ok(unit.issuedAt);assert.equal(unit.startedAt,null);assert.equal(unit.completedAt,null);const issuedAt=unit.issuedAt,outcome=await root.runStage(currentTask,session,{});assert.equal(outcome.kind,'stage_complete');assert.equal(session.currentStage,null);const completed=session.completedWorkUnits.find(item=>item.id==='audit');assert.equal(completed.status,'COMPLETED');assert.equal(completed.issuedAt,issuedAt);assert.ok(completed.startedAt);assert.ok(completed.completedAt);assert.ok(new Date(completed.updatedAt).getTime()>=new Date(completed.startedAt).getTime());assert.equal(completed.updatedAt,completed.completedAt);
});

test('Root turn keeps its semantic activity title instead of masquerading as a Work Unit',async()=>{
  const snapshots=[],executor={async runRoot({onExecutionStarted,onProgress}){onExecutionStarted?.();onProgress?.({summary:'Codex 正在执行',detail:'模型正在进行 Task 级判断。'});return{kind:'complete',summary:'完成',finalResult:'完成',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],delegations:[],gateway:null,gapResolutions:[]};},async runSubagent(){throw new Error('unused');}},router=new ModelRouter(),root=new RootRuntime({executor,modelRouter:router,subagentRuntime:new SubagentRuntime({executor,modelRouter:router})}),currentTask=task('T-ROOT-OBS'),session=root.createSession(currentTask);await root.runRootTurn(currentTask,session,{onProgress:snapshot=>snapshots.push(snapshot),onExecutionStarted(){}},{activityKind:'initial'});assert.ok(snapshots.some(snapshot=>snapshot.actor?.title==='Root 初始判断'));assert.equal(snapshots.at(-1)?.actor?.title,'Root 初始判断');assert.equal(snapshots.at(-1)?.stage,null);
});

test('UI and active specification use the same certified-conclusion terminology',()=>{const html=readFileSync(new URL('../src/ui/index.html',import.meta.url),'utf8'),spec=readFileSync(new URL('../docs/SPECIFICATION.md',import.meta.url),'utf8');assert.match(html,/已确认结论/);assert.match(html,/已通过认证并进入当前 Task 认知/);assert.match(spec,/User-facing durable analysis is labeled `已确认结论`/);assert.doesNotMatch(html,/已确认进展/);assert.doesNotMatch(spec,/已确认进展/);});
