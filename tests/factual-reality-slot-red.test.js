import test from 'node:test';
import assert from 'node:assert/strict';
import { projectCertifiedKnownClaims } from '../src/core/certified-cognition-reuse.js';

function claim(id,statement,evidenceId){
  return {
    id,
    statement,
    level:'confirmed',
    evidenceIds:[evidenceId],
    scope:'single_system',
    coverage:'component',
    subjectRefs:['server:A'],
    obligationRefs:[],
  };
}

test('RED: paraphrases of the same factual Reality slot must not project as two active known facts',()=>{
  const task={
    analysisState:{current:{claims:[
      claim('C-JDK-1','JDK is 1.7','E-1'),
      claim('C-JDK-2','Java runtime version = 1.7','E-2'),
    ]}},
  };
  const known=projectCertifiedKnownClaims(task,{subjectRefs:['server:A']});
  assert.equal(known.length,1,'same subject/property/value should project once even when wording differs');
});
