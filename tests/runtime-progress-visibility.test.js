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
import { TaskStatus, WorkUnitStatus } from '../src/core/types.js';

function delegation(id='a',title='提取附件需求') {
  return { id, title, goal:title, expectedOutput:'返回可验证结果', stopCondition:'当前目标完成后停止', projectAccess:'none', networkAccess:false, skillId:null, dependsOn:[], inputRefs:[] };
}

function makeRoot(executor) {
  const router=new ModelRouter();
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  return new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,maxConcurrentSubagents:1});
}

test('completed Work Units survive a cleared stage in runtime snapshot without becoming certified state',async()=>{
  const executor={async runRoot(){throw new Error('unused');},async runSubagent(){throw new Error('unused');}};
  const root=makeRoot(executor);
  const task={id:'T-PROGRESS',title:'进展可见性',instruction:'测试',projectScopes:[],attachments:[],references:[],analysisState:null};
  const session=root.createSession(task);
  const stage=root.createStage(session,[delegation()]);
  stage.workUnits[0].status=WorkUnitStatus.COMPLETED;
  stage.workUnits[0].owner='subagent';
  stage.workUnits[0].detail='附件分析完成。';
  stage.workUnits[0].updatedAt='2026-08-11T01:00:00.000Z';

  const outcome=await root.runStage(task,session,{});
  assert.equal(outcome.kind,'stage_complete');
  assert.equal(session.currentStage,null);
  const snapshot=root.makeSnapshot(session);
  assert.equal(snapshot.completedWorkUnits.length,1);
  assert.equal(snapshot.completedWorkUnits[0].title,'提取附件需求');
  assert.equal(snapshot.completedWorkUnits[0].status,WorkUnitStatus.COMPLETED);
  assert.equal(snapshot.completedWorkUnits[0].stageId,'stage-1');
  assert.equal(session.analysisState.version,0,'runtime process visibility must not mutate certified cognition');
  assert.equal('completedWorkUnits' in session.analysisState,false);
});

test('WAITING_HUMAN preserves completed execution progress in executionState but not knowledge History',async()=>{
  let rootCalls=0;
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      if(!subagentResults.length)return{kind:'delegate',summary:'先提取附件',stageResult:null,finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[delegation()]};
      return{kind:'human_gateway',summary:'需要用户确认',stageResult:'附件工作已完成',finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:{question:'请选择范围',context:'需要确认',options:['A','B']},delegations:[]};
    },
    async runSubagent({delegation,onExecutionStarted}){onExecutionStarted?.();return{delegationId:delegation.id,result:'附件分析完成。',evidence:[],claims:[],gaps:[],recommendations:[],discoveries:[],blocker:null,uncertainty:null};},
  };
  const dir=mkdtempSync(join(tmpdir(),'taskboard-progress-wait-'));
  const database=new JsonTaskDatabase(join(dir,'db.json'));
  const repository=new JsonTaskRepository(database);
  const service=new TaskService(repository);
  const root=makeRoot(executor);
  const scheduler=new Scheduler({repository,taskService:service,rootRuntime:root,intervalMs:999999});
  try{
    const task=scheduler.createTask({title:'等待人类前保留进展',instruction:'执行'});
    await scheduler.tick();
    const waiting=service.getTask(task.id);
    assert.equal(waiting.status,TaskStatus.WAITING_HUMAN);
    assert.equal(rootCalls,2);
    assert.ok(waiting.executionState?.snapshot,'waiting task must persist its last runtime view');
    const visible=[...(waiting.executionState.snapshot.completedWorkUnits||[]),...(waiting.executionState.snapshot.stage?.workUnits||[])];
    assert.ok(visible.some(unit=>unit.title==='提取附件需求'&&unit.status===WorkUnitStatus.COMPLETED));
    assert.equal(service.progressHistory(task.id).length,0,'completed process work must not masquerade as certified knowledge History');
    assert.equal(waiting.analysisState?.version||0,0);
    scheduler.activities.delete(task.id);
    const activity=scheduler.getTaskActivity(task.id);
    assert.ok(activity.current,'WAITING_HUMAN runtime view must survive loss of the in-memory activity cache');
    assert.ok((activity.current.stage?.workUnits||[]).some(unit=>unit.title==='提取附件需求'));
    scheduler.answerHumanGateway(task.id,'A');
    assert.equal(service.getTask(task.id).executionState,null,'the temporary waiting snapshot is cleared when execution resumes');
  } finally {
    scheduler.stop();
    database.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
