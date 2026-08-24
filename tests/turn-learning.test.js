import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { applyCertifiedDelta, decisionFromCertifiedState, emptyCertifiedState, normalizeCertifiedState } from '../src/governance/certified-state.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';

function evidence(id='E-1',observation='外部备注不可修改'){return{id,strength:'direct',kind:'requirement',sourceType:'reference',coverage:'source',statement:observation,basis:`reference:${id}`,locator:'Referenced completed Result',observation};}
function claim(id='C-1',statement='外部备注不可修改',evidenceIds=['E-1']){return{id,statement,level:'confirmed',evidenceIds,scope:'general',coverage:'source',hops:[],obligationRefs:[]};}
function decision(overrides={}){return{kind:'complete',summary:'',finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[],...overrides};}
function validator(){return new ValidatorRuntime({sourceTraceVerifier:{enforce:({evidence:items})=>({evidence:items,actions:[],verifications:[]})}});}

test('Certified State is monotonic by omission',()=>{
  const first=applyCertifiedDelta(emptyCertifiedState(),decision({evidence:[evidence()],claims:[claim()]}),{triggerRefs:['task:T'],committedAt:'2026-08-11T00:00:00.000Z'});assert.equal(first.state.version,1);assert.equal(first.turnNode.id,'TURN-0001');
  const second=applyCertifiedDelta(first.state,decision(),{triggerRefs:['work:WU-2']});assert.equal(second.state.version,1);assert.equal(second.turnNode,null);assert.equal(second.current.claims[0].statement,'外部备注不可修改');
});

test('committed Claim revision requires new Evidence',()=>{
  const first=applyCertifiedDelta(emptyCertifiedState(),decision({evidence:[evidence()],claims:[claim()]}));
  const illegal=applyCertifiedDelta(first.state,decision({claims:[claim('C-1','外部备注可以修改',['E-1'])]}));assert.equal(illegal.current.claims[0].statement,'外部备注不可修改');assert.ok(illegal.issues.some(x=>x.code==='CLAIM_REVISION_REQUIRES_NEW_EVIDENCE'));
  const revised=applyCertifiedDelta(first.state,decision({evidence:[evidence('E-2','新来源限制了适用范围')],claims:[claim('C-1','仅特定范围可修改',['E-1','E-2'])]}));assert.equal(revised.state.version,2);assert.equal(revised.current.claims[0].statement,'仅特定范围可修改');
});

test('Recommendations and Steps are presentation, not durable Task cognition',()=>{
  const recommendation={id:'R-1',statement:'建议核对映射',rationale:'仍有映射缺口',evidenceIds:['E-1'],gapIds:[]},step={order:1,text:'外部备注不可修改',kind:'confirmed',sourceIds:['C-1']};
  const first=applyCertifiedDelta(emptyCertifiedState(),decision({evidence:[evidence()],claims:[claim()],recommendations:[recommendation],steps:[step]}));assert.deepEqual(first.current.recommendations,[]);assert.deepEqual(first.current.steps,[]);
  const presentation=decisionFromCertifiedState(first.state,decision({recommendations:[recommendation],steps:[step]}));assert.equal(presentation.recommendations.length,1);assert.equal(presentation.steps.length,1);assert.equal('stageResult' in presentation,false);
  const migrated=normalizeCertifiedState({version:1,current:{...first.current,recommendations:[recommendation],steps:[step]},turns:[]});assert.deepEqual(migrated.current.recommendations,[]);assert.deepEqual(migrated.current.steps,[]);
});

test('Root next Turn receives current certified state, not a replayed semantic history layer',async()=>{
  let rootCalls=0;const seen=[];
  const executor={
    async runRoot({certifiedContext}){rootCalls+=1;seen.push(certifiedContext);if(rootCalls===1)return decision({kind:'delegate',evidence:[evidence()],claims:[claim()],delegations:[{id:'WU-1',title:'继续核对',goal:'返回局部结果',expectedOutput:'局部结果',stopCondition:'得到结果即停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]}]});return decision({kind:'complete'});},
    async runSubagent({delegation}){return{delegationId:delegation.id,result:'局部工作完成',evidence:[],blocker:null};},
  };
  const router=new ModelRouter(),subagent=new SubagentRuntime({executor,modelRouter:router}),root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:validator(),maxConcurrentSubagents:1});
  const commits=[],outcome=await root.execute({id:'T-LEARN',title:'需求分析',instruction:'分析',projectScopes:[],attachments:[],references:[],analysisState:null},{onCertifiedTurn:commit=>commits.push(commit)});
  assert.equal(rootCalls,2);assert.equal(commits.length,1);assert.equal('historyCommit' in commits[0].turnNode,false);assert.equal(seen[0].claims.length,0);assert.equal(seen[1].claims[0].statement,'外部备注不可修改');assert.equal(outcome.kind,'goal_satisfied');assert.match(outcome.proposal.finalResult,/外部备注不可修改/);
});

test('Gap closes only through an evidence-backed Root resolution',()=>{
  const withGap=applyCertifiedDelta(emptyCertifiedState(),decision({gaps:[{id:'G-1',question:'待确认字段',reason:'缺少证据',kind:'missing_fact',blocking:false,evidenceIds:[]}]}));
  const unsupported=applyCertifiedDelta(withGap.state,decision({gapResolutions:[{gapId:'G-1',reason:'已经确认',evidenceIds:[]}]}));assert.equal(unsupported.current.gaps.length,1);assert.ok(unsupported.issues.some(x=>x.code==='GAP_RESOLUTION_REQUIRES_EVIDENCE'));
  const resolved=applyCertifiedDelta(withGap.state,decision({evidence:[evidence('E-2','MWMS 接收字段')],claims:[claim('C-2','MWMS 接收字段',['E-2'])],gapResolutions:[{gapId:'G-1',reason:'Root 根据 E-2 判断缺口已闭合',evidenceIds:['E-2']}]}));assert.equal(resolved.current.gaps.length,0);
});

test('Certified State is durable while progress History is not synthesized from cognition',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-turn-json-')),file=join(dir,'taskboard.json'),database=new JsonTaskDatabase(file),repository=new JsonTaskRepository(database),task=repository.createTask({title:'学习测试',instruction:'分析',attachments:[]}),learned=applyCertifiedDelta(emptyCertifiedState(),decision({evidence:[evidence()],claims:[claim()]}));
  repository.commitCertifiedTurn(task.id,{analysisState:learned.state});assert.equal(repository.getTask(task.id).analysisState.version,1);assert.equal(repository.getProgressHistory(task.id).length,0);assert.equal('analysisState' in new TaskService(repository).getTask(task.id),false);database.close();
  const reopened=new JsonTaskDatabase(file),repo2=new JsonTaskRepository(reopened);assert.equal(repo2.getTask(task.id).analysisState.current.claims[0].statement,'外部备注不可修改');reopened.close();rmSync(dir,{recursive:true,force:true});
});
