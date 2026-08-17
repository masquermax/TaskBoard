import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { RootRuntime, validateDelegationPlan } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { ModelRouter } from '../src/core/model-router.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { AttachmentStore } from '../src/core/attachment-store.js';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { MockExecutor } from '../src/extensions/executors/mock/mock-executor.js';
import { createApp } from '../src/server/app.js';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';

function runtime(executor={}){const router=new ModelRouter();const subagent=new SubagentRuntime({executor,modelRouter:router});return new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent});}

test('delegation plan validates work identity and dependencies without confusing Work Unit count with Subagent concurrency',()=>{
  const many=validateDelegationPlan([
    {id:'a',title:'A',goal:'A',expectedOutput:'A result',stopCondition:'A done',skillId:null,dependsOn:[]},
    {id:'b',title:'B',goal:'B',expectedOutput:'B result',stopCondition:'B done',skillId:null,dependsOn:[]},
    {id:'c',title:'C',goal:'C',expectedOutput:'C result',stopCondition:'C done',skillId:null,dependsOn:[]},
    {id:'d',title:'D',goal:'D',expectedOutput:'D result',stopCondition:'D done',skillId:null,dependsOn:[]},
    {id:'e',title:'E',goal:'E',expectedOutput:'E result',stopCondition:'E done',skillId:null,dependsOn:[]},
    {id:'f',title:'F',goal:'F',expectedOutput:'F result',stopCondition:'F done',skillId:null,dependsOn:['e']},
  ]);
  assert.equal(many.valid,true,'Work Unit count is not a concurrency limit; runtime admission controls active Subagents');
  assert.equal(many.delegations.length,6);

  const duplicate=validateDelegationPlan([
    {id:'dup',title:'A',goal:'A',expectedOutput:'A result',stopCondition:'A done',skillId:null,dependsOn:[]},
    {id:'dup',title:'B',goal:'B',expectedOutput:'B result',stopCondition:'B done',skillId:null,dependsOn:[]},
  ]);
  assert.equal(duplicate.valid,false);
  assert.match(duplicate.issues.join(' '),/id 重复/);

  const unknown=validateDelegationPlan([
    {id:'a',title:'A',goal:'A',expectedOutput:'A result',stopCondition:'A done',skillId:null,dependsOn:['missing']},
  ]);
  assert.equal(unknown.valid,false);
  assert.match(unknown.issues.join(' '),/依赖不存在/);

  const cycle=validateDelegationPlan([
    {id:'a',title:'A',goal:'A',expectedOutput:'A result',stopCondition:'A done',skillId:null,dependsOn:['b']},
    {id:'b',title:'B',goal:'B',expectedOutput:'B result',stopCondition:'B done',skillId:null,dependsOn:['a']},
  ]);
  assert.equal(cycle.valid,false);
  assert.match(cycle.issues.join(' '),/循环/);
});

test('attachment cleanup uses a path boundary, not a shared string prefix',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-attachment-boundary-'));
  const root=join(dir,'attachments');const outside=join(dir,'attachments-escape');mkdirSync(root);mkdirSync(outside);const outsideFile=join(outside,'keep.txt');writeFileSync(outsideFile,'keep');
  try{
    const store=new AttachmentStore({rootDir:root});
    assert.equal(store.owns(outsideFile),false);
    store.removeTaskAttachments([{path:outsideFile}]);
    assert.equal(existsSync(outsideFile),true);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('HTTP rejects malformed JSON and encoded static path traversal instead of returning 500 or serving outside files',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-http-audit-'));const db=new JsonTaskDatabase(join(dir,'db.json'));const repo=new JsonTaskRepository(db);const service=new TaskService(repo);
  const server=createServer(createApp({taskService:service,executor:new MockExecutor(),uiRoot:resolve('src/ui')}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const malformed=await fetch(`${base}/api/tasks`,{method:'POST',headers:{'content-type':'application/json','x-taskboard-action':'ui'},body:'{"title":'});assert.equal(malformed.status,400);assert.equal((await malformed.json()).error,'INVALID_JSON');
    const traversalStatus=await new Promise((resolveStatus,reject)=>{const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:'/%2e%2e/%2e%2e/etc/passwd',method:'GET'},res=>{res.resume();res.on('end',()=>resolveStatus(res.statusCode));});req.on('error',reject);req.end();});assert.equal(traversalStatus,404);
  }finally{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Subagent returns source-traced local findings; Task-level certainty remains Root authority',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-subagent-local-'));const file=join(dir,'A.java');writeFileSync(file,'存在一个相关字段');
  const executor={async runSubagent(){return{delegationId:'d',result:'local result',evidence:[{id:'E-1',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'存在一个相关字段',basis:'A.java',locator:'A.java',observation:'存在一个相关字段'}],findings:[{id:'F-1',statement:'发现候选字段',evidenceIds:['E-1']}],discoveries:[],blocker:null,uncertainty:null};}};
  const router=new ModelRouter();const subagent=new SubagentRuntime({executor,modelRouter:router});
  try{
    const result=await subagent.run({id:'T-1',title:'分析',instruction:'分析',projectScopes:[{path:dir}]}, {id:'d',title:'查证',goal:'核对字段关系',expectedOutput:'返回字段关系证据',stopCondition:'关系闭合或形成 Gap',projectAccess:'read',inputRefs:['project:0'],skillId:null,dependsOn:[]}, {policyContext:{taskMode:'analysis'}});
    assert.equal(result.evidence[0].strength,'direct');
    assert.equal(result.findings[0].statement,'发现候选字段');
    assert.equal('claims' in result,false);
    assert.equal('gaps' in result,false);
    assert.equal('recommendations' in result,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('ModelRouter releases per-task capability cache when execution session is discarded',()=>{
  const router=new ModelRouter();router.prepared.set('T-1',{x:1});router.release('T-1');assert.equal(router.prepared.has('T-1'),false);
});

test('invalid Root delegation graph is repaired internally without creating a Task-level failure or Human Gateway',async()=>{
  let turns=0;
  const executor={
    async runRoot({planningFeedback}){
      turns+=1;
      if(turns===1)return{kind:'delegate',summary:'bad plan',stageResult:null,finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[
        {id:'a',title:'A',goal:'A',expectedOutput:'A result',stopCondition:'A done',skillId:null,dependsOn:['b']},
        {id:'b',title:'B',goal:'B',expectedOutput:'B result',stopCondition:'B done',skillId:null,dependsOn:['a']},
      ]};
      assert.ok(Array.isArray(planningFeedback)&&planningFeedback.some(x=>/循环/.test(x)));
      return{kind:'complete',summary:'replanned',stageResult:'done',finalResult:'完成',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,delegations:[]};
    },
    async runSubagent(){throw new Error('Subagent must not run for invalid plan');},
  };
  const root=runtime(executor);
  const outcome=await root.execute({id:'T-plan',title:'执行',instruction:'执行任务',projectScopes:[],attachments:[],references:[]});
  assert.equal(outcome.kind,'goal_satisfied');
  assert.equal(outcome.proposal.finalResult,'完成');
  assert.equal(turns,2);
});

test('business progress never exposes raw shell commands from Codex command execution events',()=>{
  const source=readFileSync(join(process.cwd(),'src/extensions/executors/codex/app-server-client.js'),'utf8');
  assert.doesNotMatch(source,/detail\s*:\s*item\.command/);
  assert.doesNotMatch(source,/summary\s*:\s*item\.command/);
  assert.match(source,/正在核对证据/);
});


test('progress copy is projected from the canonical actor role instead of mixed Root/Subagent wording',()=>{
  const scheduler=readFileSync(resolve('src/core/scheduler.js'),'utf8');
  const client=readFileSync(resolve('src/extensions/executors/codex/app-server-client.js'),'utf8');
  assert.doesNotMatch(scheduler,/Root Agent \/ Subagent|Root Agent 正在组织当前工作/);
  assert.doesNotMatch(client,/Root\/Subagent 执行|分析当前 Task 与真实项目状态/);
  assert.match(scheduler,/Validator 正在认证当前候选结果/);
  assert.match(scheduler,/Subagent 正在执行/);
  assert.match(client,/模型正在认证当前证明关系/);
  assert.match(client,/模型正在执行当前 Work Unit/);
  assert.match(client,/模型正在进行 Task 级判断/);
});


test('Mock Executor validates control flow without manufacturing business Evidence',async()=>{
  const executor=new MockExecutor();
  const root=await executor.runRoot({task:{id:'T-MOCK',title:'明确任务',instruction:'执行',attachments:[]},humanGatewayHistory:[],policyContext:{taskMode:'analysis'}});
  assert.deepEqual(root.evidence,[]);
  assert.deepEqual(root.claims,[]);
  const sub=await executor.runSubagent({delegation:{id:'WU-1',title:'测试工作'}});
  assert.deepEqual(sub.evidence,[]);
  assert.equal('claims' in sub,false);
  assert.equal('gaps' in sub,false);
  assert.equal('recommendations' in sub,false);
});


test('current runtime contains no removed role or duplicate-domain entry outside migration boundaries',()=>{
  const allowed=new Set([
    'src/core/runtime-settings.js',
    'src/core/runtime-state-migration.js',
    'src/core/retry-policy.js',
  ]);
  const files=[];
  const walk=dir=>{for(const entry of readdirSync(resolve(dir),{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())walk(path);else if(entry.isFile()&&path.endsWith('.js'))files.push(path);}};
  walk('src');
  const forbidden=/SystemFilter|\bOUTSIDE\b|temporaryPath|taskMaxThreads|workerConcurrency|runLead|runWorker|LeadRuntime|WorkerRuntime|ExecutionAdapterPort|ownerLabel|ownerType|RESOURCE_WAIT|pendingSubagentValidation|reviewSubagent|resumeValidation|workerExecutionWindowMs|\bWorker\b|\bworker\b/;
  for(const file of files){if(allowed.has(file))continue;assert.doesNotMatch(readFileSync(resolve(file),'utf8'),forbidden,`legacy current-domain entry leaked into ${file}`);}
});

test('current documentation is one active set and does not reintroduce superseded version artifacts or role names',()=>{
  const expected=[
    'ADR.md','ARCHITECTURE.md','ARCHITECTURE_REVIEW.md','CAPABILITY_CONTRACTS.md','CAPABILITY_MAP.md',
    'CODEX_INTEGRATION.md','CURRENT_STATE.md','EXTENSIONS.md','PRODUCT_CONSTITUTION.md','SPECIFICATION.md','VERIFICATION.md',
  ];
  const actual=readdirSync(resolve('docs')).filter(name=>name.endsWith('.md')).sort();
  assert.deepEqual(actual,expected.slice().sort());
  const currentState=readFileSync(resolve('docs/CURRENT_STATE.md'),'utf8');
  const active=[readFileSync(resolve('README.md'),'utf8'),...actual.filter(name=>name!=='CURRENT_STATE.md').map(name=>readFileSync(resolve('docs',name),'utf8'))].join('\n');
  assert.doesNotMatch(active,/Root Agent|Execution Adapter|TOOL_EXECUTOR|Project Registry|SystemFilter|\bOUTSIDE\b|taskMaxThreads|workerConcurrency|ownerType|ownerLabel|RESOURCE_WAIT|Task maximum threads|VERIFICATION-0\.|RULE_REALIGNMENT|ANALYSIS_RULES/);
  assert.match(currentState,/## Migration-only names/,'legacy names may be documented only in the explicit migration boundary');
});
