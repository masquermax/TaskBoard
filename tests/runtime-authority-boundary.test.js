import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
import { AnalysisResultValidator } from '../src/governance/analysis-validator.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';

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

test('Capability Contract compiles into one typed executionGrant for Root, Subagent and Validator',()=>{
  const compiler=new GovernanceCompiler({rootDir});
  const task=analysisTask(['/project/a','/project/b']);
  const root=compiler.compileForRole(task,'root');
  const validator=compiler.compileForRole(task,'validator');
  const subagent=compiler.compileForRole(task,'subagent',{workUnit:{
    id:'WU-1',projectAccess:'read',networkAccess:false,inputRefs:['project:1'],skillId:null,
  }});

  assert.deepEqual(root.executionGrant,{
    role:'root',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',
  });
  assert.deepEqual(validator.executionGrant,{
    role:'validator',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'proof-only',
  });
  assert.deepEqual(subagent.executionGrant,{
    role:'subagent',projectAccess:'read',networkAccess:false,inputRefs:['project:1'],sourceAccess:'selected',
  });
});

test('CodexExecutor consumes executionGrant and projects it to an explicit runtime workspace/permission boundary',async()=>{
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
    assert.equal(call.permissionProfile,':read-only');
    assert.deepEqual(call.runtimeWorkspaceRoots,[call.cwd]);
    assert.equal(call.runtimeWorkspaceRoots.includes(project),false,'Root runtime roots must not include Project Scope');
    assert.equal(call.networkAccess,false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('source-backed analysis cannot complete on the initial Root turn without delegated source work',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-completion-source-'));
  const project=join(dir,'project');mkdirSync(project);
  let rootTurns=0;
  const executor={
    async runRoot(){
      rootTurns+=1;
      return {
        kind:'complete',summary:'分析已完成：0 项已确认，1 项待确认。',stageResult:null,finalResult:null,resultMode:'analysis',
        evidence:[],claims:[],gaps:[{id:'G-1',question:'待确认实现',reason:'未调查',kind:'missing_fact',blocking:false,evidenceIds:[]}],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[],
      };
    },
    async runSubagent(){throw new Error('no work should have been available');},
  };
  const router=new ModelRouter();
  const subagent=new SubagentRuntime({executor,modelRouter:router});
  const runtime=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:analysisValidatorRuntime()});
  try{
    await assert.rejects(
      runtime.execute(analysisTask([project])),
      /SOURCE_ANALYSIS_REQUIRES_DELEGATED_EVIDENCE/,
    );
    assert.equal(rootTurns,1);
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
  const runtime=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,maxConcurrentSubagents:2});
  const outcome=await runtime.execute({id:'T-WORK',title:'执行',instruction:'执行',projectScopes:[],attachments:[],references:[],ready_reason:'NEW'});
  assert.equal(outcome.kind,'complete');
  assert.equal(workRuns,2);
  assert.equal(bCompleted,true,'an issued Work Unit is a real obligation unless Root explicitly supersedes it; complete must not cancel it implicitly');
  assert.ok(rootTurns>=2);
});
