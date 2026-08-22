import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyCertifiedDelta } from '../src/governance/certified-state.js';
import { RootRuntime } from '../src/core/root-runtime.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { GovernanceCompiler } from '../src/governance/governance-compiler.js';
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

test('T-0016 shape converges after one read-only Work Unit even when synthesis redundantly restates the resolved Gap',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-t0016-'));
  try{
    writeFileSync(join(dir,'facts.txt'),'alpha=17\nbeta=29\n','utf8');
    const work={id:'WU-001',title:'Read facts.txt',goal:'Read alpha and beta from facts.txt.',expectedOutput:'Return both values with exact source lines.',stopCondition:'Both values and their source lines are established.',projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']};
    let rootCalls=0,subagentCalls=0;
    const executor={
      async runRoot({subagentResults,onExecutionStarted}){
        rootCalls+=1;onExecutionStarted?.();
        if(!subagentResults.length)return decision('delegate',{gaps:[gap()],delegations:[work]});
        return decision('complete',{
          claims:[{id:'C-FACTS',statement:'facts.txt establishes alpha=17 and beta=29.',level:'confirmed',evidenceIds:['E-FACTS'],scope:'single_system',coverage:'component',hops:[],obligationRefs:['OBL-FACTS']}],
          gaps:[gap({reason:'Stale restatement emitted alongside the real closure.'})],
          gapResolutions:[{gapId:'G-001',reason:'Direct project-file evidence now establishes both values.',evidenceIds:['E-FACTS']}],
        });
      },
      async runSubagent({delegation,onExecutionStarted}){
        subagentCalls+=1;onExecutionStarted?.();assert.equal(delegation.id,'WU-001');
        return{delegationId:'WU-001',result:'alpha=17; beta=29',evidence:[evidence('E-FACTS')],blocker:null};
      },
    };
    const modelRouter={async prepare(){},route(){return{};},release(){}};
    const compiler=new GovernanceCompiler();
    const completionEvaluator={evaluate({certifiedContext}){
      assert.equal(certifiedContext.gaps.some(item=>item.id==='G-001'),false);
      assert.deepEqual(certifiedContext.claims.find(item=>item.id==='C-FACTS')?.obligationRefs,['OBL-FACTS']);
      return{goalState:'satisfied',assessments:[]};
    }};
    const runtime=new RootRuntime({executor,modelRouter,subagentRuntime:new SubagentRuntime({executor,modelRouter}),validatorRuntime:new ValidatorRuntime(),governanceCompiler:compiler,completionEvaluator});
    const task={id:'T-0016-SHAPE',title:'Read facts',instruction:'Read facts.txt and report alpha and beta with sources. Do not modify files.',ready_reason:'NEW',projectScopes:[{path:dir,label:'test'}],attachments:[],references:[],taskContract:{authority:{},obligations:[{id:'OBL-FACTS',certification:'supported'}]},analysisState:null,workReceipts:[]};

    const outcome=await runtime.execute(task);
    assert.equal(outcome.kind,'goal_satisfied');
    assert.equal(rootCalls,2);
    assert.equal(subagentCalls,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
