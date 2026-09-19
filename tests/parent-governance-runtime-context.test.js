import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRootExecutorRequest, compileSubagentExecutorRequest } from '../src/core/executor-contract.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { RootRuntime, validateDelegationPlan } from '../src/core/root-runtime.js';
import { compileAuthorizedGrant } from '../src/governance/governance-compiler.js';
import { successfulCompletionDependenciesForControlFlowTest } from './helpers/completion-fixture.js';

function governedTask(){
  return{
    id:'T-PARENT',title:'parent binding',instruction:'achieve the governed outcome',
    projectScopes:[],attachments:[],references:[],
    taskContract:{
      id:'TC-T-PARENT',revision:3,
      authority:{},
      obligations:[{
        id:'OBL-T-PARENT-GOAL',certification:'supported',
        requirementRefs:[{sourceId:'REQ-T-PARENT-0001',start:0,end:28}],
        criterion:{mode:'outcome',acceptedOutcomes:['succeeded']},
      }],
      constraints:[{id:'C-NO-BYPASS',kind:'parent_invariant',statement:'Do not bypass the governed parent boundary.'}],
    },
  };
}

function boundedWork(overrides={}){
  return{
    id:'WU-1',title:'inspect one discriminator',goal:'inspect one bounded fact',expectedOutput:'one observed fact',stopCondition:'fact or blocker returned',
    obligationRefs:['OBL-T-PARENT-GOAL'],projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[],...overrides,
  };
}

const expectedParentGovernance={
  contractId:'TC-T-PARENT',revision:3,
  obligations:[{
    id:'OBL-T-PARENT-GOAL',certification:'supported',
    requirementRefs:[{sourceId:'REQ-T-PARENT-0001',start:0,end:28}],
    criterion:{mode:'outcome',acceptedOutcomes:['succeeded']},
  }],
  constraints:[{id:'C-NO-BYPASS',kind:'parent_invariant',statement:'Do not bypass the governed parent boundary.'}],
};

function certifiedAnalysisState(){
  return{
    version:2,
    current:{
      resultMode:'analysis',evidence:[],gaps:[],recommendations:[],steps:[],
      claims:[
        {id:'CLM-JDK',statement:'Current runtime uses JDK 1.7.',level:'confirmed',evidenceIds:['EV-JDK'],scope:'single_system',coverage:'system',hops:[],obligationRefs:[]},
        {id:'CLM-HYP',statement:'Font loading may depend on one candidate path.',level:'supported',evidenceIds:['EV-HYP'],scope:'single_system',coverage:'component',hops:[],obligationRefs:[]},
      ],
    },
    turns:[],
  };
}

test('Root receives the governed parent contract instead of relying on conversational memory',()=>{
  const request=compileRootExecutorRequest({task:governedTask(),certifiedContext:{claims:[],gaps:[],unresolvedObligations:[]}});
  assert.deepEqual(request.context.parentGovernance,expectedParentGovernance);
  assert.match(request.instructions,/parentGovernance is the inherited Task-level boundary/);
  assert.match(request.instructions,/Local usefulness alone is not sufficient/);
  assert.ok(request.responseContract.properties.delegations.items.required.includes('obligationRefs'));
});

test('Subagent compiler receives the same parent boundary but remains a bounded executor',()=>{
  const task=governedTask();
  const request=compileSubagentExecutorRequest({task,delegation:boundedWork()});
  assert.deepEqual(request.context.parentGovernance,expectedParentGovernance);
  assert.deepEqual(request.context.workUnit.obligationRefs,['OBL-T-PARENT-GOAL']);
  assert.match(request.instructions,/workUnit\.obligationRefs identifies the parent obligation/);
  assert.match(request.instructions,/Respect its obligations and constraints before acting/);
  assert.match(request.instructions,/do not work around it/);
  assert.match(request.instructions,/A local result never proves a parent obligation or Task completion/);

  request.context.parentGovernance.constraints[0].statement='mutated';
  assert.equal(task.taskContract.constraints[0].statement,'Do not bypass the governed parent boundary.','Runtime context must not alias durable Task state');
});

test('Subagent receives only CONFIRMED durable cognition, not supported inference or raw history',()=>{
  const task=governedTask();
  task.analysisState=certifiedAnalysisState();
  task.workReceipts=[{id:'WR-OLD',result:{result:'raw history'}}];
  const request=compileSubagentExecutorRequest({task,delegation:boundedWork()});
  assert.deepEqual(request.context.knownClaims,[{
    id:'CLM-JDK',statement:'Current runtime uses JDK 1.7.',evidenceIds:['EV-JDK'],scope:'single_system',coverage:'system',obligationRefs:[],
  }]);
  assert.equal('workReceipts' in request.context,false,'raw historical receipts must not be replayed as memory');
  assert.match(request.instructions,/do not spend this Work merely rediscovering the same fact/);

  request.context.knownClaims[0].statement='mutated';
  assert.equal(task.analysisState.current.claims[0].statement,'Current runtime uses JDK 1.7.','downward projection must not alias durable cognition');
});

test('actual SubagentRuntime scoping preserves parent governance and certified cognition into the executor request',async()=>{
  const task=governedTask();task.analysisState=certifiedAnalysisState();
  let seen=null;
  const executor={
    async runSubagent({task,delegation}){
      const request=compileSubagentExecutorRequest({task,delegation});
      seen={parentGovernance:request.context.parentGovernance,obligationRefs:request.context.workUnit.obligationRefs,knownClaims:request.context.knownClaims};
      return{delegationId:delegation.id,result:'observed',evidence:[],blocker:null};
    },
  };
  const modelRouter={prepare:async()=>{},route:()=>({})};
  const runtime=new SubagentRuntime({executor,modelRouter});
  const result=await runtime.run(task,boundedWork());
  assert.equal(result.result,'observed');
  assert.deepEqual(seen.parentGovernance,expectedParentGovernance,'Task input scoping must not erase the parent TaskContract before Executor compilation');
  assert.deepEqual(seen.obligationRefs,['OBL-T-PARENT-GOAL']);
  assert.deepEqual(seen.knownClaims.map(item=>item.id),['CLM-JDK'],'Task input scoping must carry already-certified cognition into later child execution');
});

test('delegation plan auto-binds one unambiguous parent obligation and rejects ambiguous or foreign bindings',()=>{
  const one=validateDelegationPlan([boundedWork({obligationRefs:[]})],{governedObligationIds:['OBL-A']});
  assert.equal(one.valid,true);
  assert.deepEqual(one.delegations[0].obligationRefs,['OBL-A']);

  const ambiguous=validateDelegationPlan([boundedWork({obligationRefs:[]})],{governedObligationIds:['OBL-A','OBL-B']});
  assert.equal(ambiguous.valid,false);
  assert.match(ambiguous.issues.join(' '),/必须通过 obligationRefs 显式绑定至少一个父级 obligation/);

  const foreign=validateDelegationPlan([boundedWork({obligationRefs:['OBL-X']})],{governedObligationIds:['OBL-A','OBL-B']});
  assert.equal(foreign.valid,false);
  assert.match(foreign.issues.join(' '),/不存在的父级 obligation：OBL-X/);
});

test('RootRuntime carries the parent-position binding through Stage into the actual Subagent Work Unit',async()=>{
  const task=governedTask();
  let rootCalls=0,seenWork=null;
  const executor={
    async runRoot(){
      rootCalls+=1;
      if(rootCalls===1)return{
        kind:'delegate',summary:'inspect one fact',finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],effectClosures:[],
        delegations:[boundedWork({obligationRefs:[]})],
      };
      return{kind:'complete',summary:'done',finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[],effectClosures:[]};
    },
    async runSubagent({delegation}){seenWork=delegation;return{delegationId:delegation.id,result:'observed',evidence:[],blocker:null};},
  };
  const modelRouter={prepare:async()=>{},route:()=>({}),release:()=>{}};
  const subagentRuntime=new SubagentRuntime({executor,modelRouter});
  const root=new RootRuntime({...successfulCompletionDependenciesForControlFlowTest(),executor,modelRouter,subagentRuntime,maxConcurrentSubagents:1});
  const outcome=await root.execute(task);
  assert.equal(outcome.kind,'goal_satisfied');
  assert.deepEqual(seenWork.obligationRefs,['OBL-T-PARENT-GOAL'],'sole governed obligation should be bound before the Work Unit reaches Subagent Runtime');
});

test('semantic parent governance cannot widen the executable AuthorizedGrant',()=>{
  const task=governedTask();
  task.projectScopes=[{path:'/project',label:'project'}];
  task.taskContract.constraints.push({id:'C-WRITE-WISH',kind:'parent_invariant',statement:'Local work would like write access.'});
  const grant=compileAuthorizedGrant({
    role:'subagent',task,
    workUnit:{...boundedWork(),projectAccess:'write',networkAccess:true,inputRefs:['project:0']},
  });
  assert.equal(grant.projectAccess,'read','parent semantic context cannot manufacture project-write authority');
  assert.equal(grant.networkAccess,false,'parent semantic context cannot manufacture network authority');
});

test('missing TaskContract produces an explicit empty parent boundary rather than invented governance',()=>{
  const task={id:'T-EMPTY',title:'empty',instruction:'inspect',projectScopes:[],attachments:[],references:[]};
  const request=compileSubagentExecutorRequest({task,delegation:{id:'WU-1'}});
  assert.deepEqual(request.context.parentGovernance,{contractId:null,revision:null,obligations:[],constraints:[]});
  assert.deepEqual(request.context.knownClaims,[]);
});
