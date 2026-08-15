import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { RootRuntime } from '../src/core/root-runtime.js';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';

function certifiedDecision() {
  return {
    kind:'delegate',
    summary:'新增已认证事实',
    stageResult:null,
    finalResult:null,
    resultMode:'analysis',
    evidence:[{
      id:'E-HISTORY',
      strength:'direct',
      kind:'fact',
      sourceType:'human',
      coverage:'component',
      statement:'已确认事实',
      basis:'Human Gateway answer',
      locator:'Human Gateway answer',
      observation:'已确认事实',
    }],
    claims:[{
      id:'C-HISTORY',
      statement:'已确认事实',
      level:'confirmed',
      evidenceIds:['E-HISTORY'],
      scope:'single_system',
      coverage:'component',
      hops:[],
    }],
    gaps:[],
    recommendations:[],
    steps:[],
    gateway:null,
    gapResolutions:[],
    delegations:[],
  };
}

test('D-006: the Validator History-value decision must be the durable History decision source', async()=>{
  const validatorCommit={
    title:'VALIDATOR_HISTORY_SENTINEL',
    detail:'Validator 已决定这个 certified delta 形成 durable History。',
    sourceIds:['C-HISTORY'],
  };
  const validatorRuntime={
    reviewRoot({decision}){
      return {
        outcome:'pass',
        decision,
        feedback:[],
        actions:[],
        commits:[validatorCommit],
        observedKnowledgeKeys:['claim:C-HISTORY:已确认事实'],
      };
    },
    async semanticReviewRoot({reviewed}){ return reviewed; },
  };
  const rootRuntime=new RootRuntime({
    executor:{cleanupTaskWorkspace(){return false;}},
    modelRouter:{release(){}},
    subagentRuntime:{},
    validatorRuntime,
  });
  const task={
    id:'T-HISTORY',
    title:'History owner probe',
    instruction:'认证一个事实',
    projectScopes:[],attachments:[],references:[],
    analysisState:null,workReceipts:[],last_stage_result:null,
  };
  const session=rootRuntime.createSession(task);
  let durableCommit=null;

  const reviewed=await rootRuntime.reviewRootDecision(
    task,
    session,
    certifiedDecision(),
    {onCertifiedTurn:commit=>{durableCommit=commit;}},
    {triggerRefs:['test:history-owner']},
  );

  assert.ok(durableCommit?.turnNode,'fixture must cross the real certified-turn boundary');
  assert.deepEqual(
    durableCommit.historyCommit && {
      title:durableCommit.historyCommit.title,
      detail:durableCommit.historyCommit.detail,
      sourceIds:durableCommit.historyCommit.sourceIds,
    },
    validatorCommit,
    'Task Core durable History must consume the Validator-owned History decision rather than a second RootRuntime producer',
  );
  assert.deepEqual(reviewed.commits,[validatorCommit],
    'the History decision exposed by the certified Root review must remain the Validator-owned decision');
});

test('certified-turn persistence rolls back analysis state, receipt consumption and History atomically when persist fails',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-certified-turn-rollback-'));
  const db=new JsonTaskDatabase(join(dir,'db.json'));
  const repo=new JsonTaskRepository(db);
  try{
    const task=repo.createTask({title:'atomic rollback',instruction:'验证原子提交'});
    repo.commitWorkReceipt(task.id,{
      id:'WU-ATOMIC',
      signature:'atomic-signature',
      workUnit:{
        id:'WU-ATOMIC',title:'probe',goal:'probe',expectedOutput:'probe',stopCondition:'done',
        projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[],
      },
      result:{delegationId:'WU-ATOMIC',result:'done',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null},
      completed_at:'2026-08-15T00:00:00.000Z',
    });
    const before=repo.getTask(task.id);
    assert.equal(before.analysisState,null);
    assert.equal(before.workReceipts[0].consumed_at,null);
    assert.deepEqual(repo.getProgressHistory(task.id),[]);

    const originalPersist=db.persist.bind(db);
    db.persist=()=>{throw new Error('FORCED_PERSIST_FAILURE');};
    try{
      assert.throws(()=>repo.commitCertifiedTurn(task.id,{
        analysisState:{version:1,current:{resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[]},turns:[]},
        workReceiptIds:['WU-ATOMIC'],
        historyCommit:{title:'atomic history',detail:'must roll back',completedAt:'2026-08-15T00:00:01.000Z'},
      }),/FORCED_PERSIST_FAILURE/);
    }finally{
      db.persist=originalPersist;
    }

    const after=repo.getTask(task.id);
    assert.equal(after.analysisState,null,'analysis_state must roll back');
    assert.equal(after.workReceipts[0].consumed_at,null,'WorkReceipt consumption must roll back');
    assert.equal(after.last_stage_result,null,'last_stage_result must roll back with History');
    assert.deepEqual(repo.getProgressHistory(task.id),[],'History append must roll back');
  }finally{
    db.close();
    rmSync(dir,{recursive:true,force:true});
  }
});
