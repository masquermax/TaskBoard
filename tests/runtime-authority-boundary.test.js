import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { ModelRouter } from '../src/core/model-router.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';

class CaptureClient{constructor(){this.calls=[];}async runTurn(request){this.calls.push(request);return JSON.stringify({kind:'complete',summary:'ok',finalResult:'ok',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]});}}
function taskWithProject(path){return{id:'T-AUTH',title:'项目分析',instruction:'根据项目分析当前实现',projectScopes:[{label:'P',path}],attachments:[],references:[],taskContract:{authority:{}},analysisState:null,workReceipts:[]};}

test('completed Work Unit receipt survives process/session boundaries without becoming public Task context',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-work-receipt-')),db=new JsonTaskDatabase(join(dir,'db.json')),repo=new JsonTaskRepository(db),service=new TaskService(repo);
  try{
    const task=repo.createTask({title:'receipt',instruction:'分析当前实现'}),receipt={id:'WU-1',signature:'sig-1',workUnit:{id:'WU-1',title:'scan',goal:'scan',expectedOutput:'result',stopCondition:'done',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},result:{delegationId:'WU-1',result:'done',evidence:[],blocker:null},completed_at:'2026-08-13T00:00:00.000Z'};
    repo.commitWorkReceipt(task.id,receipt);repo.commitWorkReceipt(task.id,{...receipt,id:'WU-other'});
    let stored=repo.getTask(task.id).workReceipts;assert.equal(stored.length,1);assert.equal(stored[0].consumed_at,null);
    const publicTask=service.getTask(task.id);for(const key of ['analysisState','analysis_state','workReceipts','work_receipts','execution_state'])assert.equal(key in publicTask,false,key);
    repo.commitCertifiedTurn(task.id,{analysisState:{version:0,current:{resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[]},turns:[]},workReceiptIds:['WU-1']});
    stored=repo.getTask(task.id).workReceipts;assert.ok(stored[0].consumed_at);
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('GovernanceCompiler emits executable AuthorizedGrant only for Root and Subagent',()=>{
  const compiler=new GovernanceCompiler(),task={id:'T',projectScopes:[{path:'/project/a'}],taskContract:{authority:{}}},root=compiler.compileForRole(task,'root'),subagent=compiler.compileForRole(task,'subagent',{workUnit:{id:'WU',projectAccess:'read',networkAccess:false,inputRefs:['project:0']}});
  assert.deepEqual(root.authorizedGrant,{role:'root',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',environmentAccess:'none'});
  assert.deepEqual(subagent.authorizedGrant,{role:'subagent',projectAccess:'read',networkAccess:false,inputRefs:['project:0'],sourceAccess:'selected',environmentAccess:'default'});
  assert.throws(()=>compiler.compileForRole(task,'validator'),/ROLE_NOT_EXECUTABLE:validator/,'Validator is deterministic Runtime enforcement, not an Executor/model role');
});

test('CodexExecutor projects Root grant to a runtime boundary with no Project/network access',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-authority-grant-')),project=join(dir,'project');mkdirSync(project);const client=new CaptureClient(),executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client});
  try{const task=taskWithProject(project),policyContext=new GovernanceCompiler().compileForRole(task,'root');await executor.runRoot({task,subagentResults:[],humanGatewayHistory:[],certifiedContext:{claims:[],gaps:[],unresolvedObligations:[]},modelPolicy:{},policyContext});const call=client.calls[0];assert.equal(call.permissionProfile,'taskboard_runtime');assert.equal(call.runtimeWorkspaceRoots.includes(project),false);assert.equal(call.networkAccess,false);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Root sees a Stage only after every issued sibling Work Unit has finished',async()=>{
  let rootTurns=0,workRuns=0,bCompleted=false;
  const executor={
    async runRoot({subagentResults}){
      rootTurns+=1;
      if(rootTurns===1)return{kind:'delegate',summary:'分工',finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[{id:'A',title:'A',goal:'A',expectedOutput:'A',stopCondition:'A done',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},{id:'B',title:'B',goal:'B',expectedOutput:'B',stopCondition:'B done',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]}]};
      assert.equal(subagentResults.length,2,'Root is not awakened once per sibling');
      return{kind:'complete',summary:'done',finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};
    },
    async runSubagent({delegation}){workRuns+=1;if(delegation.id==='B'){await new Promise(r=>setTimeout(r,20));bCompleted=true;}return{delegationId:delegation.id,result:`${delegation.id} done`,evidence:[],blocker:null};},
  };
  const router=new ModelRouter(),subagent=new SubagentRuntime({executor,modelRouter:router}),runtime=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,maxConcurrentSubagents:2}),outcome=await runtime.execute({id:'T-WORK',title:'执行',instruction:'执行',projectScopes:[],attachments:[],references:[],ready_reason:'NEW'});
  assert.equal(outcome.kind,'goal_satisfied');assert.equal(workRuns,2);assert.equal(bCompleted,true);assert.equal(rootTurns,2);
});
