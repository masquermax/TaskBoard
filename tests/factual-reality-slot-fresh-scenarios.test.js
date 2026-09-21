import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCertifiedKnownClaims } from '../src/core/certified-cognition-reuse.js';
import { applyCertifiedDelta, emptyCertifiedState } from '../src/governance/certified-state.js';

function claim({id,statement,property='',value='',subjectRefs=[],scope='single_system',evidenceIds=[]}){
  return {
    id,
    statement,
    level:'confirmed',
    evidenceIds,
    scope,
    coverage:'component',
    hops:[],
    factProperty:property,
    factValue:value,
    subjectRefs,
    obligationRefs:[],
  };
}

function evidence(id){return {id,strength:'direct'};}

test('fresh scenario: deployment path paraphrases collapse by explicit factual coordinate',()=>{
  const task={analysisState:{current:{claims:[
    claim({id:'C-PATH-1',statement:'Tomcat home is /app/ekp/linux64/tomcat',property:'Tomcat home',value:'/app/ekp/linux64/tomcat',subjectRefs:['host:prod-app01'],evidenceIds:['E-1']}),
    claim({id:'C-PATH-2',statement:'Container runtime path = /app/ekp/linux64/tomcat',property:'Tomcat home',value:'/app/ekp/linux64/tomcat',subjectRefs:['host:prod-app01'],evidenceIds:['E-2']}),
  ]}}};
  const known=projectCertifiedKnownClaims(task,{subjectRefs:['host:prod-app01']});
  assert.equal(known.length,1);
  assert.equal(known[0].factValue,'/app/ekp/linux64/tomcat');
  assert.deepEqual(known[0].evidenceIds,['E-1','E-2']);
});

test('fresh scenario: boolean runtime state revises one active slot with new Evidence',()=>{
  const first=applyCertifiedDelta(emptyCertifiedState(),{
    evidence:[evidence('E-OLD')],
    claims:[claim({id:'C-WAF',statement:'WAF enabled',property:'WAF enabled',value:'true',subjectRefs:['site:academy'],evidenceIds:['E-OLD']})],
  });
  const second=applyCertifiedDelta(first.state,{
    evidence:[evidence('E-NEW')],
    claims:[claim({id:'C-WAF-NEW',statement:'WAF is now disabled',property:'WAF enabled',value:'false',subjectRefs:['site:academy'],evidenceIds:['E-NEW']})],
  });
  assert.deepEqual(second.issues,[]);
  assert.equal(second.state.current.claims.length,1);
  assert.equal(second.state.current.claims[0].id,'C-WAF');
  assert.equal(second.state.current.claims[0].factValue,'false');
});

test('fresh scenario: identical property/value under different scopes remain distinct Reality',()=>{
  const task={analysisState:{current:{claims:[
    claim({id:'C-RUN',statement:'Runtime port 8086',property:'listen port',value:'8086',subjectRefs:['service:academy'],scope:'runtime',evidenceIds:['E-RUN']}),
    claim({id:'C-PLAN',statement:'Planned port 8086',property:'listen port',value:'8086',subjectRefs:['service:academy'],scope:'planned',evidenceIds:['E-PLAN']}),
  ]}}};
  const known=projectCertifiedKnownClaims(task,{subjectRefs:['service:academy']});
  assert.equal(known.length,2);
  assert.deepEqual(known.map(item=>item.scope).sort(),['planned','runtime']);
});

test('fresh scenario: relational Claims stay semantic and are never collapsed as state slots',()=>{
  const task={analysisState:{current:{claims:[
    claim({id:'C-REL-1',statement:'Nginx forwards academy traffic to Tomcat',subjectRefs:['service:academy'],evidenceIds:['E-1']}),
    claim({id:'C-REL-2',statement:'Tomcat receives academy traffic through Nginx',subjectRefs:['service:academy'],evidenceIds:['E-2']}),
  ]}}};
  const known=projectCertifiedKnownClaims(task,{subjectRefs:['service:academy']});
  assert.equal(known.length,2);
  assert.deepEqual(known.map(item=>item.id),['C-REL-1','C-REL-2']);
});
