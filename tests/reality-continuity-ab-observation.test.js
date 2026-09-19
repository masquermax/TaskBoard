import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRootExecutorRequest, compileSubagentExecutorRequest, ROOT_RESPONSE_CONTRACT } from '../src/core/executor-contract.js';

function task(){
  return {
    id:'T-AB',title:'bluebird-style runtime continuity',instruction:'Continue work on server A with minimum sufficient Reality.',
    projectScopes:[],attachments:[],references:[],taskContract:{id:'TC-AB',revision:1,authority:{},obligations:[],constraints:[]},
    analysisState:{version:1,current:{resultMode:'analysis',evidence:[],claims:[
      {id:'C-A-JDK',statement:'server A uses JDK 1.7',level:'confirmed',evidenceIds:['E-A-JDK'],scope:'single_system',coverage:'system',hops:[],subjectRefs:['server:A'],obligationRefs:[]},
      {id:'C-B-JDK',statement:'server B uses JDK 8',level:'confirmed',evidenceIds:['E-B-JDK'],scope:'single_system',coverage:'system',hops:[],subjectRefs:['server:B'],obligationRefs:[]},
      {id:'C-GENERAL',statement:'the requested inspection is read-only',level:'confirmed',evidenceIds:['E-GENERAL'],scope:'general',coverage:'system',hops:[],subjectRefs:[],obligationRefs:[]},
      {id:'C-OS-GUESS',statement:'server A is probably Windows 10',level:'supported',evidenceIds:['E-OS-GUESS'],scope:'single_system',coverage:'system',hops:[],subjectRefs:['server:A'],obligationRefs:[]},
    ],gaps:[],recommendations:[],steps:[]},turns:[]},
  };
}

function work(){
  return {id:'WU-A',title:'Inspect app state on A',goal:'Inspect only the app state needed for the next decision.',expectedOutput:'Enough state to choose the next action.',stopCondition:'The next action can be chosen safely.',obligationRefs:[],subjectRefs:['server:A'],projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};
}

test('A/B observation: report what the actual Runtime exposes for the same server task',()=>{
  const t=task(),w=work();
  const sub=compileSubagentExecutorRequest({task:t,delegation:w});
  const root=compileRootExecutorRequest({task:t,humanGatewayHistory:[{id:'HG-OS',status:'RESOLVED',targetGapId:'G-OS',question:'What OS is this?',answer:'大概是 Win10'}]});
  const known=Array.isArray(sub?.context?.knownClaims)?sub.context.knownClaims:[];
  const ids=known.map(x=>x.id);
  const targetKnown=ids.includes('C-A-JDK');
  const metrics={
    targetKnown,
    knownClaimIds:ids,
    nextJdkAction:targetKnown?'reuse-known-jdk':'probe-java-version-again',
    foreignServerBVisible:ids.includes('C-B-JDK'),
    supportedGuessPromoted:ids.includes('C-OS-GUESS'),
    subjectAwareRootSchema:Boolean(ROOT_RESPONSE_CONTRACT?.properties?.delegations?.items?.properties?.subjectRefs),
    subjectAwareClaimSchema:Boolean(ROOT_RESPONSE_CONTRACT?.properties?.claims?.items?.properties?.subjectRefs),
    minimumSufficientRealityGuard:/precision needed for the next decision|plausible values.*change the next action/i.test(root.instructions),
    cheapBatchingGuard:/near-zero incremental effort|broad health check/i.test(root.instructions),
    zeroCostHarvestGuard:/zero extra probing cost|another decision-relevant or near-term reusable fact/i.test(sub.instructions),
    contradictionUpwardGuard:/conflicts with a known Claim|return source-near Evidence/i.test(sub.instructions),
  };
  console.log('REALITY_CONTINUITY_AB='+JSON.stringify(metrics));
  assert.equal(typeof metrics.nextJdkAction,'string');
});
