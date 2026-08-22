import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCertifiedDelta } from '../src/governance/certified-state.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';

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
function unsupportedClaimDecision(){
  return decision('complete',{claims:[{id:'C-001',statement:'unsupported claim',level:'confirmed',evidenceIds:[],scope:'general',coverage:'component',hops:[],obligationRefs:[]}]});
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

test('the same deterministic Validator rejection gets one repair turn but cannot consume an unbounded series of Root turns',async()=>{
  let rootCalls=0;
  const executor={
    async runRoot({onExecutionStarted}){
      rootCalls+=1;
      if(rootCalls>2)throw new Error('TEST_TOO_MANY_ROOT_TURNS');
      onExecutionStarted?.();
      return unsupportedClaimDecision();
    },
  };
  const modelRouter={async prepare(){},route(){return{};},release(){}};
  const runtime=new RootRuntime({executor,modelRouter,subagentRuntime:{},validatorRuntime:new ValidatorRuntime()});
  const task={id:'T-CONVERGE',title:'convergence',instruction:'bounded',ready_reason:'NEW',projectScopes:[],attachments:[],references:[],taskContract:{obligations:[]},analysisState:null,workReceipts:[]};

  await assert.rejects(runtime.execute(task),/VALIDATOR_REJECTION_NON_CONVERGENCE/);
  assert.equal(rootCalls,2);
});
