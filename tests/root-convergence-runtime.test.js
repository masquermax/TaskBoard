import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCertifiedDelta } from '../src/governance/certified-state.js';
import { RootRuntime } from '../src/core/root-runtime.js';

function evidence(id='E-NEW'){
  return{id,strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'alpha=17 and beta=29',basis:'facts.txt',locator:'facts.txt:1-2',observation:'alpha=17\nbeta=29'};
}
function gap(overrides={}){
  return{id:'G-001',question:'What are alpha and beta?',reason:'Project values have not been read yet.',kind:'missing_fact',blocking:true,evidenceIds:[],...overrides};
}
function analysisState(){
  return{version:1,current:{resultMode:'analysis',evidence:[],claims:[],gaps:[gap()],recommendations:[],steps:[]},turns:[]};
}
function decision(kind='complete',overrides={}){
  return{kind,summary:'bounded control',finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[],effectClosures:[],...overrides};
}

test('a valid DIRECT gap resolution wins over a redundant same-turn restatement of that gap',()=>{
  const next=applyCertifiedDelta(analysisState(),decision('complete',{
    evidence:[evidence()],
    gaps:[gap({reason:'Values were read; this stale gap should not survive the same turn.'})],
    gapResolutions:[{gapId:'G-001',reason:'facts.txt directly establishes both values.',evidenceIds:['E-NEW']}],
  }),{triggerRefs:['work:WU-001']});

  assert.deepEqual(next.issues,[]);
  assert.equal(next.current.gaps.some(item=>item.id==='G-001'),false);
  assert.deepEqual(next.delta.gapResolutions.map(item=>item.gapId),['G-001']);
});

test('the same deterministic Validator rejection may get one repair turn but cannot consume an unbounded series of Root turns',async()=>{
  let rootCalls=0;
  const executor={
    async runRoot({onExecutionStarted}){
      rootCalls+=1;
      if(rootCalls>2)throw new Error('TEST_TOO_MANY_ROOT_TURNS');
      onExecutionStarted?.();
      return decision('complete');
    },
  };
  const modelRouter={async prepare(){},route(){return{};},release(){}};
  const validatorRuntime={
    reviewRoot(){return{outcome:'reject',decision:decision('complete'),feedback:[{ruleId:'C-003',target:'claim:C-001',reason:'same deterministic rejection',action:'REJECT_LEDGER_ENTRY'}],actions:[]};},
  };
  const runtime=new RootRuntime({executor,modelRouter,subagentRuntime:{},validatorRuntime});
  const task={id:'T-CONVERGE',title:'convergence',instruction:'bounded',ready_reason:'NEW',projectScopes:[],attachments:[],references:[],taskContract:{obligations:[]},analysisState:null,workReceipts:[]};

  await assert.rejects(runtime.execute(task),/ROOT_VALIDATOR_REJECTION_NON_CONVERGENCE/);
  assert.equal(rootCalls,2);
});
