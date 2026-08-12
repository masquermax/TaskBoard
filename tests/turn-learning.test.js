import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyCertifiedDelta, decisionFromCertifiedState, emptyCertifiedState, normalizeCertifiedState } from '../src/governance/certified-state.js';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';

function evidence(id, observation='外部备注不可修改') {
  return {id,strength:'direct',kind:'requirement',sourceType:'reference',coverage:'source',statement:observation,basis:`reference:${id}`,locator:'Referenced completed Result',observation};
}
function claim(id, statement='外部备注不可修改', evidenceIds=['E-1']) {
  return {id,statement,level:'confirmed',evidenceIds,scope:'general',coverage:'source',hops:[]};
}
function rootDecision(overrides={}) {
  return {kind:'complete',summary:'',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[],...overrides};
}

test('Certified State is monotonic by omission: later Turn cannot forget committed knowledge',()=>{
  const first=applyCertifiedDelta(emptyCertifiedState(),rootDecision({evidence:[evidence('E-1')],claims:[claim('C-1')]}),{triggerRefs:['task:T-1'],committedAt:'2026-08-11T00:00:00.000Z'});
  assert.equal(first.state.version,1);
  assert.equal(first.turnNode.id,'TURN-0001');
  assert.equal(first.current.claims[0].statement,'外部备注不可修改');

  const second=applyCertifiedDelta(first.state,rootDecision(),{triggerRefs:['WU-2'],committedAt:'2026-08-11T00:01:00.000Z'});
  assert.equal(second.state.version,1,'no new certified knowledge means no fake Turn Node');
  assert.equal(second.turnNode,null);
  assert.equal(second.current.claims[0].statement,'外部备注不可修改','absence means unchanged, not forgotten');
});

test('Committed Claim cannot be silently rewritten; new evidence can revise it explicitly',()=>{
  const first=applyCertifiedDelta(emptyCertifiedState(),rootDecision({evidence:[evidence('E-1')],claims:[claim('C-1')]}));
  const illegal=applyCertifiedDelta(first.state,rootDecision({claims:[claim('C-1','外部备注可以修改',['E-1'])]}));
  assert.equal(illegal.current.claims[0].statement,'外部备注不可修改');
  assert.ok(illegal.issues.some(issue=>issue.code==='CLAIM_REVISION_REQUIRES_NEW_EVIDENCE'));
  assert.equal(illegal.turnNode,null);

  const revised=applyCertifiedDelta(first.state,rootDecision({
    evidence:[evidence('E-2','新配置证明该字段在特定范围可修改')],
    claims:[claim('C-1','外部备注仅在特定范围可修改',['E-1','E-2'])],
  }));
  assert.equal(revised.state.version,2);
  assert.equal(revised.current.claims[0].statement,'外部备注仅在特定范围可修改');
  assert.equal(revised.turnNode.baseVersion,1);
});

test('Recommendations and Steps are current presentation, not durable learned state',()=>{
  const recommendation={id:'R-1',statement:'建议核对映射',rationale:'仍有映射缺口',evidenceIds:['E-1'],gapIds:[]};
  const step={order:1,text:'外部备注不可修改',kind:'confirmed',sourceIds:['C-1']};
  const first=applyCertifiedDelta(emptyCertifiedState(),rootDecision({evidence:[evidence('E-1')],claims:[claim('C-1')],recommendations:[recommendation],steps:[step]}));
  assert.equal(first.current.recommendations.length,0);
  assert.equal(first.current.steps.length,0);
  assert.equal(first.turnNode.delta.recommendations.length,0);
  assert.equal(first.turnNode.delta.steps.length,0);

  const presentation=decisionFromCertifiedState(first.state,rootDecision({recommendations:[recommendation],steps:[step]}));
  assert.equal(presentation.recommendations.length,1);
  assert.equal(presentation.steps.length,1);

  const migrated=normalizeCertifiedState({version:1,current:{...first.current,recommendations:[recommendation],steps:[step]},turns:[]});
  assert.equal(migrated.current.recommendations.length,0,'legacy accumulated advice is discarded on load');
  assert.equal(migrated.current.steps.length,0);
});

test('Root next Turn receives committed state and final result is rendered from accumulated certified state',async()=>{
  let rootCalls=0;
  const seenStates=[];
  const executor={
    async runRoot({certifiedContext}){
      rootCalls+=1;
      seenStates.push(certifiedContext);
      if(rootCalls===1){
        return rootDecision({
          kind:'delegate',
          evidence:[evidence('E-1')],
          claims:[claim('C-1')],
          delegations:[{id:'WU-1',title:'继续核对',goal:'返回一个局部结果',expectedOutput:'局部结果',stopCondition:'得到结果即停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]}],
        });
      }
      assert.equal(certifiedContext.claims[0].statement,'外部备注不可修改');
      return rootDecision({kind:'complete'});
    },
    async runSubagent({delegation}){
      return {delegationId:delegation.id,result:'局部工作完成',evidence:[],claims:[],gaps:[],recommendations:[],discoveries:[],blocker:null,uncertainty:null};
    },
  };
  const router=new ModelRouter();
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const validator=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:[]})}});
  const root=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:validator,maxConcurrentSubagents:1});
  const commits=[];
  const outcome=await root.execute({id:'T-LEARN',title:'需求分析',instruction:'分析附件',projectScopes:[],attachments:[],references:[],analysisState:null},{onCertifiedTurn:commit=>commits.push(commit)});
  assert.equal(rootCalls,2);
  assert.equal(commits.length,1);
  assert.equal(commits[0].turnNode.id,'TURN-0001');
  assert.equal(seenStates[0].claims.length,0);
  assert.equal(seenStates[1].claims[0].statement,'外部备注不可修改');
  assert.equal(outcome.kind,'complete');
  assert.match(outcome.finalResult,/外部备注不可修改/);
  assert.match(outcome.summary,/1 项已确认/);
});



test('A new Root Runtime after restart continues from durable Current Certified State instead of starting over',async()=>{
  const learned=applyCertifiedDelta(emptyCertifiedState(),rootDecision({evidence:[evidence('E-1')],claims:[claim('C-1')]}));
  let seen=null;
  const executor={
    async runRoot({certifiedContext}){seen=certifiedContext;return rootDecision({kind:'complete'});},
    async runSubagent(){throw new Error('unused');},
  };
  const router=new ModelRouter();
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const validator=new ValidatorRuntime({analysisValidator:new AnalysisResultValidator(),sourceTraceVerifier:{enforce:({evidence})=>({evidence,actions:[],verifications:[]})}});
  const root=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:validator});
  const outcome=await root.execute({id:'T-RECOVER',title:'需求分析',instruction:'继续分析',projectScopes:[],attachments:[],references:[],analysisState:learned.state});
  assert.equal(seen.claims[0].statement,'外部备注不可修改');
  assert.match(outcome.finalResult,/外部备注不可修改/);
});

test('Gap space only shrinks through an evidence-backed certified resolution',()=>{
  const withGap=applyCertifiedDelta(emptyCertifiedState(),rootDecision({
    gaps:[{id:'G-1',question:'待确认：ERP→MWMS 接收字段',reason:'当前没有接收端证据',kind:'missing_fact',blocking:false,evidenceIds:[]}],
  }));
  assert.equal(withGap.current.gaps.length,1);

  const unsupported=applyCertifiedDelta(withGap.state,rootDecision({gapResolutions:[{gapId:'G-1',reason:'已经确认',evidenceIds:[]}]}));
  assert.equal(unsupported.current.gaps.length,1);
  assert.ok(unsupported.issues.some(issue=>issue.code==='GAP_RESOLUTION_REQUIRES_EVIDENCE'));

  const resolved=applyCertifiedDelta(withGap.state,rootDecision({
    evidence:[evidence('E-2','MWMS 接收内部备注与外部备注字段')],
    claims:[claim('C-2','MWMS 接收内部备注与外部备注字段',['E-2'])],
    gapResolutions:[{gapId:'G-1',reason:'MWMS 接收字段已由 E-2 确认',evidenceIds:['E-2']}],
  }));
  assert.equal(resolved.current.gaps.length,0);
  assert.equal(resolved.state.version,2);
  assert.equal(resolved.turnNode.delta.gapResolutions[0].gapId,'G-1');
});

test('certified Turn state is durable while TaskService keeps internal cognition private',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-turn-json-'));
  const file=join(dir,'taskboard.json');
  const database=new JsonTaskDatabase(file);
  const repository=new JsonTaskRepository(database);
  const task=repository.createTask({title:'学习测试',instruction:'分析',attachments:[]});
  const learned=applyCertifiedDelta(emptyCertifiedState(),rootDecision({evidence:[evidence('E-1')],claims:[claim('C-1')]}));
  repository.commitCertifiedTurn(task.id,{analysisState:learned.state,historyCommit:{title:'阶段事实已确认',detail:'外部备注不可修改',completedAt:'2026-08-11T00:00:00.000Z'}});
  assert.equal(repository.getTask(task.id).analysisState.version,1);
  assert.equal(repository.getProgressHistory(task.id).length,1);
  const service=new TaskService(repository);
  assert.equal('analysisState' in service.getTask(task.id),false,'internal cognition is not UI context');
  database.close();

  const reopened=new JsonTaskDatabase(file);
  const repo2=new JsonTaskRepository(reopened);
  assert.equal(repo2.getTask(task.id).analysisState.current.claims[0].statement,'外部备注不可修改');
  reopened.close();
  rmSync(dir,{recursive:true,force:true});
});
