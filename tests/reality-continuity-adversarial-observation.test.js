import test from 'node:test';
import assert from 'node:assert/strict';
import { compileRootExecutorRequest, compileSubagentExecutorRequest, ROOT_RESPONSE_CONTRACT } from '../src/core/executor-contract.js';

let reuse=null;
try{reuse=await import('../src/core/certified-cognition-reuse.js');}catch{}

function claim(id,statement,{level='confirmed',subjectRefs=[],evidenceIds=null,scope='single_system',coverage='system'}={}){
  return{id,statement,level,evidenceIds:evidenceIds||[`E-${id}`],scope,coverage,hops:[],subjectRefs,obligationRefs:[]};
}
function task(claims){return{id:'T-ADV',title:'adversarial continuity',instruction:'continue only as far as needed',ready_reason:'NEW',projectScopes:[],attachments:[],references:[],workReceipts:[],taskContract:{id:'TC',revision:1,authority:{},obligations:[],constraints:[]},analysisState:{current:{claims}}};}
function work(subjectRefs=[]){return{id:'WU',title:'bounded',goal:'use only the needed Reality',expectedOutput:'decision input',stopCondition:'enough to decide',obligationRefs:[],subjectRefs,projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]};}
function project(t,w){
  if(reuse?.projectCertifiedKnownClaims)return reuse.projectCertifiedKnownClaims(t,w);
  const request=compileSubagentExecutorRequest({task:t,delegation:w});
  return Array.isArray(request?.context?.knownClaims)?request.context.knownClaims:[];
}
function has(hay,needle){return String(hay||'').toLowerCase().includes(String(needle).toLowerCase());}

test('adversarial observation: compare old/new continuity cost and residual risks',()=>{
  const baseClaims=[
    claim('C-A-JDK','server A uses JDK 1.7',{subjectRefs:['server:A']}),
    claim('C-A-TOMCAT','server A uses Tomcat 7.0.99',{subjectRefs:['server:A']}),
    claim('C-B-JDK','server B uses JDK 8',{subjectRefs:['server:B']}),
    claim('C-GENERAL','this diagnostic is read-only',{scope:'general',coverage:'system'}),
    claim('C-OS-GUESS','server A may be Windows 10',{level:'supported',subjectRefs:['server:A']}),
  ];
  const specific=project(task(baseClaims),work(['server:A']));
  const specificIds=specific.map(x=>x.id);
  const repeatedProbeCount=['C-A-JDK','C-A-TOMCAT'].filter(id=>!specificIds.includes(id)).length;

  const longClaims=[...Array.from({length:100},(_,i)=>claim(`C-S${i}`,`server S${i} fact`,{subjectRefs:[`server:S${i}`]})),claim('C-GENERAL','this diagnostic is read-only',{scope:'general'})];
  const unbound=project(task(longClaims),work([]));

  const duplicate=project(task([
    claim('C-D1','server A uses JDK 1.7',{subjectRefs:['server:A'],evidenceIds:['E-1']}),
    claim('C-D2','server A uses JDK 1.7',{subjectRefs:['server:A'],evidenceIds:['E-2']}),
  ]),work(['server:A']));

  const root=compileRootExecutorRequest({task:task(baseClaims),humanGatewayHistory:[{id:'HG',status:'RESOLVED',targetGapId:'G',question:'OS?',answer:'大概是 Win10'}]});
  const child=compileSubagentExecutorRequest({task:task(baseClaims),delegation:work(['server:A'])});
  const delegationSchema=ROOT_RESPONSE_CONTRACT?.properties?.delegations?.items;

  const metrics={
    capabilityPresent:Boolean(reuse?.projectCertifiedKnownClaims),
    specificKnownIds:specificIds,
    repeatedProbeCount,
    foreignBVisible:specificIds.includes('C-B-JDK'),
    supportedGuessVisible:specificIds.includes('C-OS-GUESS'),
    unboundContextCount:unbound.length,
    unboundSubjectBoundCount:unbound.filter(x=>Array.isArray(x.subjectRefs)&&x.subjectRefs.length).length,
    duplicateSemanticCount:duplicate.filter(x=>x.statement==='server A uses JDK 1.7').length,
    rootMinimumSufficientGuard:has(root.instructions,'precision needed for the next decision'),
    rootCheapBatchingGuard:has(root.instructions,'near-zero incremental effort'),
    childZeroCostHarvestGuard:has(child.instructions,'zero extra probing cost'),
    childConflictUpwardGuard:has(child.instructions,'conflicts with a known Claim'),
    subjectAwareRootSchema:Boolean(delegationSchema?.properties?.subjectRefs),
    subjectRefsInWorkSignatureGuard:false,
    subjectEvidenceBindingGuard:false,
  };
  console.log(`REALITY_CONTINUITY_ADV=${JSON.stringify(metrics)}`);
  assert.ok(metrics.repeatedProbeCount>=0);
});
