import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRootExecutorRequest, compileSubagentExecutorRequest, ROOT_RESPONSE_CONTRACT } from '../src/core/executor-contract.js';
import { projectCertifiedKnownClaims, rootRealityContinuityInstructions, certifiedCognitionReuseInstructions } from '../src/core/certified-cognition-reuse.js';
import { RootRuntime } from '../src/core/root-runtime.js';

function claim(id,statement,{level='confirmed',subjectRefs=[],evidenceIds=null,obligationRefs=[]}={}){
  return{id,statement,level,evidenceIds:evidenceIds||[`E-${id}`],scope:'single_system',coverage:'system',hops:[],subjectRefs,obligationRefs};
}

function task(){
  return {
    id:'T-REALITY',title:'operate only as far as needed',instruction:'continue with minimum sufficient Reality',
    ready_reason:'NEW',projectScopes:[],attachments:[],references:[],workReceipts:[],
    taskContract:{id:'TC-REALITY',revision:1,authority:{},obligations:[],constraints:[]},
    analysisState:{current:{claims:[
      claim('C-A','server A uses JDK 1.7',{subjectRefs:['server:A']}),
      claim('C-B','server B uses JDK 8',{subjectRefs:['server:B']}),
      claim('C-GENERAL','this procedure is read-only'),
      claim('C-GUESS','the OS may be Windows 10',{level:'supported',subjectRefs:['server:A']}),
    ]}},
  };
}

function work(overrides={}){
  return{id:'WU-A',title:'inspect app on A',goal:'inspect only the needed app state',expectedOutput:'needed state',stopCondition:'decision can be made',obligationRefs:[],subjectRefs:[],projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[],...overrides};
}

function rootDecision(kind,overrides={}){
  return{kind,summary:'bounded',finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[],effectClosures:[],...overrides};
}

test('practice 1: an identity-sensitive Work receives A cognition but not B cognition',()=>{
  const known=projectCertifiedKnownClaims(task(),work({subjectRefs:['server:A']}));
  assert.deepEqual(known.map(item=>item.id),['C-A','C-GENERAL']);
  assert.deepEqual(known.find(item=>item.id==='C-A')?.subjectRefs,['server:A']);
  assert.equal(known.some(item=>item.id==='C-B'),false,'server B fact must not be borrowed into server A Work');
  assert.equal(known.some(item=>item.id==='C-GUESS'),false,'SUPPORTED guess must not become execution memory');
});

test('practice 2: when subject identity is not decision-relevant, subject-bound facts do not become ambient context',()=>{
  const known=projectCertifiedKnownClaims(task(),work({subjectRefs:[]}));
  assert.deepEqual(known.map(item=>item.id),['C-GENERAL']);
  assert.equal(known.some(item=>item.subjectRefs?.length),false);
  assert.match(certifiedCognitionReuseInstructions(),/only unbound\/general cognition is injected/i);
});

test('practice 3: approximate human information stays approximate instead of triggering precision for its own sake',()=>{
  const request=compileRootExecutorRequest({
    task:task(),
    humanGatewayHistory:[{id:'HG-OS',status:'RESOLVED',targetGapId:'G-OS',question:'What OS is this?',answer:'大概是 Win10'}],
  });
  assert.equal(request.context.resolvedHumanAnswers[0].answer,'大概是 Win10');
  assert.match(request.instructions,/precision needed for the next decision/i);
  assert.match(request.instructions,/do not create Work or Human Gateway merely to refine it/i);
  assert.match(request.instructions,/never silently upgrade it into a more exact fact/i);
  assert.match(request.instructions,/Revalidate only when the extra precision becomes decision-relevant/i);
});

test('practice 4: one human touch may batch useful cheap observations but must not become a broad health check',()=>{
  const instructions=rootRealityContinuityInstructions();
  assert.match(instructions,/human-owned action is genuinely required/i);
  assert.match(instructions,/safe\/read-only/i);
  assert.match(instructions,/near-zero incremental effort/i);
  assert.match(instructions,/likely to matter/i);
  assert.match(instructions,/Do not turn this into a broad health check/i);
});

test('practice 5: child may harvest useful facts already visible in the same output but may not expand probing',()=>{
  const request=compileSubagentExecutorRequest({task:task(),delegation:work({subjectRefs:['server:A']})});
  assert.deepEqual(request.context.knownClaims.map(item=>item.id),['C-A','C-GENERAL']);
  assert.match(request.instructions,/another decision-relevant or near-term reusable fact/i);
  assert.match(request.instructions,/zero extra probing cost/i);
  assert.match(request.instructions,/Do not expand the Work, run extra diagnostics, or inspect irrelevant details/i);
  assert.match(request.instructions,/different host\/environment/i);
  assert.match(request.instructions,/Evidence\/blocker instead of transferring the fact/i);
});

test('practice 6: strict shape uses [] to mean identity is irrelevant, without forcing an investigation',()=>{
  const delegationSchema=ROOT_RESPONSE_CONTRACT.properties.delegations.items;
  assert.ok(delegationSchema.properties.subjectRefs);
  assert.equal(delegationSchema.required.includes('subjectRefs'),true);
  const rootInstructions=rootRealityContinuityInstructions();
  const childInstructions=certifiedCognitionReuseInstructions();
  assert.match(rootInstructions,/Use subjectRefs=\[\] when identity cannot change the current decision/i);
  assert.match(childInstructions,/keep subjectRefs empty and do not investigate it/i);
});

test('practice 7: subjectRefs survives Root plan -> Stage -> actual Subagent handoff',async()=>{
  let rootCalls=0,observedWork=null;
  const executor={
    async runRoot({onExecutionStarted}){
      rootCalls+=1;onExecutionStarted?.();
      if(rootCalls===1)return rootDecision('delegate',{delegations:[work({subjectRefs:['server:A']})]});
      return rootDecision('complete');
    },
  };
  const subagentRuntime={
    async run(_task,delegation){
      observedWork=delegation;
      return{delegationId:delegation.id,result:'done',evidence:[],blocker:null};
    },
  };
  const modelRouter={async prepare(){},route(){return{};},release(){}};
  const completionEvaluator={evaluate(){return{goalState:'satisfied',assessments:[]};}};
  const runtime=new RootRuntime({executor,modelRouter,subagentRuntime,completionEvaluator});

  const outcome=await runtime.execute(task());
  assert.equal(outcome.kind,'goal_satisfied');
  assert.deepEqual(observedWork?.subjectRefs,['server:A']);
});

test('practice 8: a long Task does not dump unrelated subject cognition into unbound Work',()=>{
  const many=Array.from({length:120},(_,i)=>claim(`C-S${i}`,`server S${i} fact`,{subjectRefs:[`server:S${i}`]}));
  const t=task();
  t.analysisState.current.claims=[...many,claim('C-READONLY','operation is read-only')];
  const known=projectCertifiedKnownClaims(t,work({subjectRefs:[]}));
  assert.deepEqual(known.map(item=>item.id),['C-READONLY']);
});

test('practice 9: exact semantic duplicate Claims are collapsed before the child pays the same cognition cost twice',()=>{
  const t=task();
  t.analysisState.current.claims=[
    claim('C-A1','server A uses JDK 1.7',{subjectRefs:['server:A'],evidenceIds:['E-1'],obligationRefs:['O-1']}),
    claim('C-A2','server A uses JDK 1.7',{subjectRefs:['server:A'],evidenceIds:['E-2'],obligationRefs:['O-2']}),
    claim('C-GENERAL','operation is read-only'),
  ];
  const known=projectCertifiedKnownClaims(t,work({subjectRefs:['server:A']}));
  assert.equal(known.length,2);
  assert.equal(known[0].id,'C-A1');
  assert.deepEqual(known[0].evidenceIds,['E-1','E-2']);
  assert.deepEqual(known[0].obligationRefs,['O-1','O-2']);
});

test('practice 10: multi-subject Work receives matching subjects plus general cognition and excludes unrelated subjects',()=>{
  const t=task();
  t.analysisState.current.claims=[
    claim('C-A','A fact',{subjectRefs:['server:A']}),
    claim('C-B','B fact',{subjectRefs:['server:B']}),
    claim('C-C','C fact',{subjectRefs:['server:C']}),
    claim('C-G','general fact'),
  ];
  const known=projectCertifiedKnownClaims(t,work({subjectRefs:['server:A','server:B']}));
  assert.deepEqual(known.map(item=>item.id),['C-A','C-B','C-G']);
});

test('practice 11: duplicate subject refs do not duplicate projected cognition',()=>{
  const t=task();
  t.analysisState.current.claims=[claim('C-A','A fact',{subjectRefs:['server:A','server:A']})];
  const known=projectCertifiedKnownClaims(t,work({subjectRefs:['server:A','server:A']}));
  assert.deepEqual(known[0].subjectRefs,['server:A']);
});

test('practice 12: a relational A+B Claim is not projected into A-only Work by subject overlap',()=>{
  const t=task();
  t.analysisState.current.claims=[
    claim('C-A','A runs the application',{subjectRefs:['server:A']}),
    claim('C-A-B','A can reach B over 443',{subjectRefs:['server:A','server:B']}),
    claim('C-G','network observation is read-only'),
  ];

  const aOnly=projectCertifiedKnownClaims(t,work({subjectRefs:['server:A']}));
  assert.deepEqual(aOnly.map(item=>item.id),['C-A','C-G']);
  assert.equal(aOnly.some(item=>item.id==='C-A-B'),false,'A-only Work must not receive cognition whose truth depends on A and B');

  const pair=projectCertifiedKnownClaims(t,work({subjectRefs:['server:A','server:B']}));
  assert.deepEqual(pair.map(item=>item.id),['C-A','C-A-B','C-G']);
  assert.match(certifiedCognitionReuseInstructions(),/contains all of that Claim's subjects/i);
});
