import test from 'node:test';
import assert from 'node:assert/strict';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { RootRuntime } from '../src/core/root-runtime.js';

function task(){
  return{
    id:'T-SUBJECT',title:'subject integrity',instruction:'keep A and B separate',ready_reason:'NEW',
    projectScopes:[],attachments:[],references:[],workReceipts:[],
    taskContract:{id:'TC-SUBJECT',revision:1,authority:{},obligations:[],constraints:[]},
    analysisState:{version:0,current:{evidence:[],claims:[],gaps:[]},turns:[]},
  };
}
function evidence(id='E-1'){return{id,sourceType:'project_file',strength:'direct',locator:'fake',observation:'observed'};}
function claim(id='C-1',subjectRefs=['server:A'],evidenceIds=['E-1']){
  return{id,statement:'JDK fact',level:'confirmed',evidenceIds,scope:'single_system',coverage:'system',hops:[],subjectRefs,obligationRefs:[]};
}
function decision(claims=[]){return{kind:'complete',summary:'done',finalResult:'done',resultMode:'analysis',evidence:[],claims,gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[],effectClosures:[]};}
function passThroughTrace(){return{enforce({evidence:items}){return{evidence:items.map(item=>({...item})),actions:[],verifications:items.map(item=>({id:item.id,verified:true}))};}};}
function router(){return{async prepare(){},route(){return{};},release(){}};}

test('subject provenance: Runtime binds returned Evidence to the Work subject without persisting a second Evidence field',async()=>{
  const runtime=new SubagentRuntime({
    executor:{async runSubagent(){return{result:'ok',evidence:[evidence('E-B')],blocker:null};}},
    modelRouter:router(),
  });
  const result=await runtime.run(task(),{id:'WU-B',inputRefs:[],subjectRefs:['server:B'],dependencyResults:[]});
  assert.deepEqual(result.evidence[0]._workSubjectRefs,['server:B']);
  assert.equal(Object.keys(result.evidence[0]).includes('_workSubjectRefs'),false);
  assert.equal(JSON.stringify(result.evidence[0]).includes('_workSubjectRefs'),false);
});

test('subject provenance: B Work Evidence cannot be certified as server A',()=>{
  const item=evidence('E-B');
  Object.defineProperty(item,'_workSubjectRefs',{value:['server:B'],enumerable:false});
  const validator=new ValidatorRuntime({sourceTraceVerifier:passThroughTrace()});
  const reviewed=validator.reviewRoot({decision:decision([claim('C-A',['server:A'],['E-B'])]),task:task(),currentState:null,availableEvidence:[item]});
  assert.equal(reviewed.outcome,'reject');
  assert.equal(reviewed.feedback.some(x=>x.action==='REJECT_SUBJECT_PROVENANCE_MISMATCH'),true);
});

test('subject provenance: subject-bound Work Evidence cannot silently become ambient/general CONFIRMED cognition',()=>{
  const item=evidence('E-A');
  Object.defineProperty(item,'_workSubjectRefs',{value:['server:A'],enumerable:false});
  const validator=new ValidatorRuntime({sourceTraceVerifier:passThroughTrace()});
  const reviewed=validator.reviewRoot({decision:decision([claim('C-G',[],['E-A'])]),task:task(),currentState:null,availableEvidence:[item]});
  assert.equal(reviewed.outcome,'reject');
  assert.equal(reviewed.feedback.some(x=>x.action==='REJECT_SUBJECT_PROVENANCE_MISMATCH'),true);
});

test('subject provenance: matching Work and Claim subjects pass the deterministic boundary',()=>{
  const item=evidence('E-A');
  Object.defineProperty(item,'_workSubjectRefs',{value:['server:A'],enumerable:false});
  const validator=new ValidatorRuntime({sourceTraceVerifier:passThroughTrace()});
  const reviewed=validator.reviewRoot({decision:decision([claim('C-A',['server:A'],['E-A'])]),task:task(),currentState:null,availableEvidence:[item]});
  assert.equal(reviewed.outcome,'pass');
});

test('work identity: otherwise identical A and B Work Units are not semantic duplicates',async()=>{
  let rootCalls=0;const seen=[];
  const runtime=new RootRuntime({
    executor:{async runRoot(){rootCalls+=1;if(rootCalls===1)return{kind:'delegate',summary:'split by server',finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],effectClosures:[],delegations:[
      {id:'WU-A',title:'inspect runtime',goal:'read version',expectedOutput:'version',stopCondition:'version known',obligationRefs:[],subjectRefs:['server:A'],projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},
      {id:'WU-B',title:'inspect runtime',goal:'read version',expectedOutput:'version',stopCondition:'version known',obligationRefs:[],subjectRefs:['server:B'],projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},
    ]};return{kind:'complete',summary:'done',finalResult:'done',resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],effectClosures:[],delegations:[]};}},
    modelRouter:router(),
    subagentRuntime:{async run(_task,work){seen.push(work.subjectRefs);return{delegationId:work.id,result:'ok',evidence:[],blocker:null};}},
    completionEvaluator:{evaluate(){return{goalState:'satisfied',assessments:[]};}},
    maxConcurrentSubagents:2,
  });
  const outcome=await runtime.execute(task());
  assert.equal(outcome.kind,'goal_satisfied');
  assert.deepEqual(seen.sort((a,b)=>String(a).localeCompare(String(b))),[['server:A'],['server:B']]);
});
