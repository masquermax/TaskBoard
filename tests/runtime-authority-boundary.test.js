import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GovernanceCompiler, inferTaskMode } from '../src/governance/governance-compiler.js';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';
import { ModelRouter } from '../src/core/model-router.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';

const rootDir=process.cwd();

class CaptureClient {
  constructor(response=null){this.calls=[];this.response=response;}
  async runTurn(request){
    this.calls.push(request);
    return JSON.stringify(this.response||{
      kind:'complete',summary:'ok',stageResult:null,finalResult:null,resultMode:'analysis',
      evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[],
    });
  }
}

function analysisTask(projects=[]){return{
  id:'T-AUTH',title:'项目分析',instruction:'根据项目分析当前实现并给出结论',
  projectScopes:projects.map((path,index)=>({id:`P-${index+1}`,label:`P${index+1}`,path})),
  attachments:[],references:[],last_stage_result:null,ready_reason:'NEW',analysisState:null,
};}

function analysisValidatorRuntime(){return new ValidatorRuntime({analysisValidator:new AnalysisResultValidator()});}


test('taskMode inference does not turn noun-like current implementation analysis into write authority',()=>{
  assert.equal(inferTaskMode({title:'架构审查',instruction:'分析当前实现并定位根因'}),'analysis');
  assert.equal(inferTaskMode({title:'功能开发',instruction:'请实现这个功能并修改代码'}),'execution');
});

test('completed Work Unit result survives process/session boundaries without becoming public Task context',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-work-receipt-'));const db=new JsonTaskDatabase(join(dir,'db.json'));const repo=new JsonTaskRepository(db);const service=new TaskService(repo);
  try{
    const task=repo.createTask({title:'receipt',instruction:'分析当前实现',attachments:[{id:'A-1',name:'private.txt',mimeType:'text/plain',size:1,path:join(dir,'private.txt')}]});
    const receipt={id:'WU-1',signature:'sig-1',workUnit:{id:'WU-1',title:'scan',goal:'scan',expectedOutput:'result',stopCondition:'done',projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']},result:{delegationId:'WU-1',result:'done',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null},completed_at:'2026-08-13T00:00:00.000Z'};
    repo.commitWorkReceipt(task.id,receipt);
    repo.commitWorkReceipt(task.id,{...receipt,id:'WU-other'});
    let stored=repo.getTask(task.id).workReceipts;
    assert.equal(stored.length,1,'same semantic work remains one durable receipt even if a new id is proposed');
    assert.equal(stored[0].consumed_at,null);
    const publicTask=service.getTask(task.id);
    for(const key of ['analysisState','analysis_state','workReceipts','work_receipts','execution_state'])assert.equal(key in publicTask,false,key+' is internal Task control/context');
    assert.equal('path' in publicTask.attachments[0],false,'attachment local path is not a public Task field');
    repo.commitCertifiedTurn(task.id,{analysisState:{version:0,current:{resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[]},turns:[]},workReceiptIds:['WU-1']});
    stored=repo.getTask(task.id).workReceipts;
    assert.ok(stored[0].consumed_at,'Root consumption is durable and atomic with the certified boundary');
  }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});

test('GovernanceCompiler compiles one typed AuthorizedGrant for Root, Subagent and Validator',()=>{
  const compiler=new GovernanceCompiler({rootDir});
  const task=analysisTask(['/project/a','/project/b']);
  const root=compiler.compileForRole(task,'root');
  const validator=compiler.compileForRole(task,'validator');
  const subagent=compiler.compileForRole(task,'subagent',{workUnit:{
    id:'WU-1',projectAccess:'read',networkAccess:false,inputRefs:['project:1'],skillId:null,
  }});

  assert.deepEqual(root.authorizedGrant,{
    role:'root',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',environmentAccess:'none',
  });
  assert.deepEqual(validator.authorizedGrant,{
    role:'validator',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'proof-only',environmentAccess:'none',
  });
  assert.deepEqual(subagent.authorizedGrant,{
    role:'subagent',projectAccess:'read',networkAccess:false,inputRefs:['project:1'],sourceAccess:'selected',environmentAccess:'default',
  });
});

test('CodexExecutor enforces AuthorizedGrant and projects it to an explicit runtime workspace/permission boundary',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-authority-grant-'));
  const project=join(dir,'project');mkdirSync(project);
  const client=new CaptureClient();
  const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client});
  try{
    const task=analysisTask([project]);
    const compiler=new GovernanceCompiler({rootDir});
    const policyContext=compiler.compileForRole(task,'root');
    await executor.runRoot({task,subagentResults:[],humanGatewayHistory:[],modelPolicy:{},policyContext});
    assert.equal(client.calls.length,1);
    const call=client.calls[0];
    assert.equal(call.permissionProfile,'taskboard_runtime');
    assert.equal(call.runtimeConfig.permissions.taskboard_runtime.filesystem[':workspace_roots']['.'],'read');
    assert.equal(call.runtimeConfig.permissions.taskboard_runtime.network.enabled,false);
    assert.deepEqual(call.environments,[]);
    assert.deepEqual(call.runtimeWorkspaceRoots,[call.cwd]);
    assert.equal(call.runtimeWorkspaceRoots.includes(project),false,'Root runtime roots must not include Project Scope');
    assert.equal(call.networkAccess,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('Root completion cannot silently cancel already-issued read-only Work Units',async()=>{
  let rootTurns=0;
  let workRuns=0;
  let bCompleted=false;
  const executor={
    async runRoot({subagentResults}){
      rootTurns+=1;
      if(rootTurns===1)return{
        kind:'delegate',summary:'分工',stageResult:null,finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],
        delegations:[
          {id:'A',title:'A',goal:'A',expectedOutput:'A',stopCondition:'A done',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},
          {id:'B',title:'B',goal:'B',expectedOutput:'B',stopCondition:'B done',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},
        ],
      };
      assert.ok(subagentResults.length>=1);
      return{kind:'complete',summary:'done',stageResult:'done',finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};
    },
    async runSubagent({delegation,signal}){
      workRuns+=1;
      if(delegation.id==='B'){
        await new Promise((resolve,reject)=>{
          const timer=setTimeout(resolve,40);
          signal?.addEventListener?.('abort',()=>{clearTimeout(timer);const error=new Error('interrupted');error.interrupted=true;reject(error);},{once:true});
        });
        bCompleted=true;
      }
      return{delegationId:delegation.id,result:`${delegation.id} done`,evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};
    },
  };
  const router=new ModelRouter();
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const runtime=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime:subagent,maxConcurrentSubagents:2});
  const outcome=await runtime.execute({id:'T-WORK',title:'执行',instruction:'执行',projectScopes:[],attachments:[],references:[],ready_reason:'NEW'});
  assert.equal(outcome.kind,'goal_satisfied');
  assert.equal(workRuns,2);
  assert.equal(bCompleted,true,'an issued Work Unit is a real obligation unless Root explicitly supersedes it; complete must not cancel it implicitly');
  assert.ok(rootTurns>=2);
});