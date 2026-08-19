import test from 'node:test';
import assert from 'node:assert/strict';
import { RootRuntime } from '../src/core/root-runtime.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

const base={stageResult:null,finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};
function work(id,overrides={}){return{id,title:id,goal:'one bounded operation',expectedOutput:'one bounded result',stopCondition:'bounded result returned',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[],...overrides};}
function createRoot(delegations){
  let rootCalls=0;
  const executor={
    async runRoot({onExecutionStarted}){rootCalls+=1;onExecutionStarted?.();return{...base,kind:'delegate',summary:'plan',delegations};},
  };
  const modelRouter={async prepare(){},route(){return{};},release(){}};
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter,subagentRuntime:{async run(){throw new Error('SUBAGENT_MUST_NOT_RUN');}}});
  return{root,rootCalls:()=>rootCalls};
}

for(const scenario of [
  {name:'empty delegation',delegations:[]},
  {name:'semantic duplicate',delegations:[work('WU-A',{title:'same'}),work('WU-B',{title:'same'})].map(item=>({...item,goal:'same',expectedOutput:'same',stopCondition:'same'}))},
  {name:'self dependency',delegations:[work('WU-A',{dependsOn:['WU-A']})]},
])test(`${scenario.name} is rejected after exactly one Root model turn`,async()=>{
  const rig=createRoot(scenario.delegations);
  await assert.rejects(
    rig.root.execute({id:`T-${scenario.name}`,title:'plan contract',instruction:'test plan contract',projectScopes:[],attachments:[],references:[]}),
    error=>{
      assert.match(String(error?.message||''),/ROOT_INVALID_DELEGATION_PLAN/);
      assert.equal(error?.nonRetryable,true);
      return true;
    },
  );
  assert.equal(rig.rootCalls(),1,'Runtime must not ask Root to repair an invalid plan with another model call');
});
