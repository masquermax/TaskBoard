import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { Scheduler } from '../src/core/scheduler.js';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { TaskStatus, WorkUnitStatus } from '../src/core/types.js';

function delegation(id='a',title='提取附件需求'){return{id,title,goal:title,expectedOutput:'返回可验证结果',stopCondition:'当前目标完成后停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};}
function makeRoot(executor){const router=new ModelRouter(),subagent=new SubagentRuntime({executor,modelRouter:router});return new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:new ValidatorRuntime(),maxConcurrentSubagents:1});}

test('completed Work Units survive a cleared Stage in runtime snapshot without becoming certified state',async()=>{
  const executor={async runRoot(){throw new Error('unused');},async runSubagent(){throw new Error('unused');}},root=makeRoot(executor),task={id:'T-PROGRESS',title:'进展可见性',instruction:'测试',projectScopes:[],attachments:[],references:[],analysisState:null},session=root.createSession(task),stage=root.createStage(session,[delegation()]);stage.workUnits[0].status=WorkUnitStatus.COMPLETED;stage.workUnits[0].owner='subagent';stage.workUnits[0].detail='附件分析完成。';stage.workUnits[0].updatedAt='2026-08-11T01:00:00.000Z';
  const outcome=await root.runStage(task,session,{});assert.equal(outcome.kind,'stage_complete');assert.equal(session.currentStage,null);const snapshot=root.makeSnapshot(session);assert.equal(snapshot.completedWorkUnits.length,1);assert.equal(snapshot.completedWorkUnits[0].title,'提取附件需求');assert.equal(snapshot.completedWorkUnits[0].status,WorkUnitStatus.COMPLETED);assert.equal(snapshot.completedWorkUnits[0].stageId,'stage-1');assert.equal(session.analysisState.version,0);assert.equal('completedWorkUnits' in session.analysisState,false);
});

test('WAITING_HUMAN preserves process visibility as completedWorkUnits, not as a reopened Stage or knowledge History',async()=>{
  let rootCalls=0;const gap={id:'G-RANGE',question:'请选择范围',reason:'范围属于用户决定',kind:'business_decision',blocking:true,evidenceIds:[]};
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){rootCalls+=1;onExecutionStarted?.();if(!subagentResults.length)return{kind:'delegate',summary:'先提取附件',finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[delegation()]};return{kind:'human_gateway',summary:'需要用户确认',finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[gap],recommendations:[],steps:[],gapResolutions:[],gateway:{gapId:gap.id,question:gap.question,context:gap.reason,options:['A','B']},delegations:[]};},
    async runSubagent({delegation,onExecutionStarted}){onExecutionStarted?.();return{delegationId:delegation.id,result:'附件分析完成。',evidence:[],blocker:null};},
  };
  const dir=mkdtempSync(join(tmpdir(),'taskboard-progress-wait-')),database=new JsonTaskDatabase(join(dir,'db.json')),repository=new JsonTaskRepository(database),service=new TaskService(repository),root=makeRoot(executor),scheduler=new Scheduler({repository,taskService:service,rootRuntime:root,intervalMs:999999});
  try{
    const task=scheduler.createTask({title:'等待人类前保留进展',instruction:'执行'});await scheduler.tick();const waiting=service.getTask(task.id);assert.equal(waiting.status,TaskStatus.WAITING_HUMAN);assert.equal(rootCalls,2);assert.ok(waiting.executionState?.snapshot);assert.equal(waiting.executionState.snapshot.stage,null,'closed Stage is not revived for visibility');assert.ok((waiting.executionState.snapshot.completedWorkUnits||[]).some(unit=>unit.title==='提取附件需求'&&unit.status===WorkUnitStatus.COMPLETED));assert.equal(service.progressHistory(task.id).length,0);assert.equal(repository.getTask(task.id).analysisState?.version||0,1,'the blocking Gap is certified internally while public Task projection does not expose cognition state');
    scheduler.activities.delete(task.id);const activity=scheduler.getTaskActivity(task.id);assert.ok(activity.current);assert.equal(activity.current.stage,null);assert.ok((activity.current.completedWorkUnits||[]).some(unit=>unit.title==='提取附件需求'));
    scheduler.answerHumanGateway(task.id,'A');assert.equal(service.getTask(task.id).executionState,null,'temporary runtime visibility is cleared when the human answer becomes a fresh trigger');
  }finally{scheduler.stop();database.close();rmSync(dir,{recursive:true,force:true});}
});
