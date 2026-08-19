import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

function executionComplete(){return{kind:'complete',summary:'done',stageResult:'done',finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};}
function work(id){return{id,title:`W${id}`,goal:`execute ${id}`,expectedOutput:`result ${id}`,stopCondition:`result ${id} returned`,projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};}
function deferred(){let resolve,reject;const promise=new Promise((res,rej)=>{resolve=res;reject=rej;});return{promise,resolve,reject};}

function createRoot(executor){
  const router=new ModelRouter();
  const subagentRuntime=new SubagentRuntime({executor,modelRouter:router});
  return new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter:router,subagentRuntime,maxConcurrentSubagents:3});
}

test('Root splits one parallel stage and is woken once after all sibling Work Units finish',async()=>{
  let rootCalls=0;
  const rootInputBatches=[];
  const workerCalls=[];
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      rootInputBatches.push((subagentResults||[]).map(item=>item.delegationId).sort());
      if(rootCalls===1)return{kind:'delegate',summary:'split 3',stageResult:null,finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[work('1'),work('2'),work('3')]};
      return executionComplete();
    },
    async runSubagent({delegation,onExecutionStarted}){
      onExecutionStarted?.();workerCalls.push(delegation.id);
      const delay={1:5,2:20,3:35}[delegation.id]||1;
      await new Promise(resolve=>setTimeout(resolve,delay));
      return{delegationId:delegation.id,result:`done ${delegation.id}`,evidence:[],blocker:null};
    },
  };
  const root=createRoot(executor);
  const outcome=await root.execute({id:'T-BATCH',title:'batch',instruction:'run three independent checks',projectScopes:[],attachments:[],references:[]});

  assert.equal(outcome.kind,'goal_satisfied');
  assert.equal(rootCalls,2,'initial split + one synthesis after the whole sibling stage');
  assert.deepEqual(rootInputBatches,[[],['1','2','3']]);
  assert.deepEqual(workerCalls.sort(),['1','2','3']);
});

test('all sibling Work Units can start concurrently and partial completion cannot wake Root',async()=>{
  let rootCalls=0;
  const started=[];
  const gates=new Map(['1','2','3'].map(id=>[id,deferred()]));
  const allStarted=deferred();
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      if(rootCalls===1)return{kind:'delegate',summary:'split 3',stageResult:null,finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[work('1'),work('2'),work('3')]};
      assert.deepEqual((subagentResults||[]).map(item=>item.delegationId).sort(),['1','2','3']);
      return executionComplete();
    },
    async runSubagent({delegation,onExecutionStarted}){
      onExecutionStarted?.();started.push(delegation.id);
      if(started.length===3)allStarted.resolve();
      await gates.get(delegation.id).promise;
      return{delegationId:delegation.id,result:`done ${delegation.id}`,evidence:[],blocker:null};
    },
  };
  const root=createRoot(executor);
  const execution=root.execute({id:'T-BATCH-GATED',title:'batch',instruction:'run three independent checks',projectScopes:[],attachments:[],references:[]});

  await allStarted.promise;
  assert.equal(rootCalls,1,'Root must not be re-entered while siblings are still running');
  assert.deepEqual([...started].sort(),['1','2','3'],'all three siblings reached execution before any was released');

  gates.get('1').resolve();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rootCalls,1,'one completed sibling is not a Root trigger');

  gates.get('2').resolve();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rootCalls,1,'two completed siblings are still not a Root trigger');

  gates.get('3').resolve();
  const outcome=await execution;
  assert.equal(outcome.kind,'goal_satisfied');
  assert.equal(rootCalls,2,'Root wakes exactly once after the full stage boundary closes');
});
