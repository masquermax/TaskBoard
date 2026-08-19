import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionAssessmentVerifier } from '../src/governance/completion-assessment-verifier.js';

test('Completion does not invoke Codex Validator after Root judgment and source certification',async()=>{
  const instruction='完成 A+B+C';
  const task={
    id:'T-proof',title:'proof',requirementSources:[{id:'REQ-1',text:instruction}],
    taskContract:{obligations:[{id:'O-1',certification:'supported',requirementRefs:[{sourceId:'REQ-1',start:0,end:instruction.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}}]},
  };
  let modelCalls=0;
  const verifier=new CompletionAssessmentVerifier({executor:{async runValidator(){modelCalls+=1;throw new Error('MODEL_MUST_NOT_RUN');}}});
  const result=await verifier.review({
    task,
    proposal:{finalResult:'Root says all done'},
    certifiedContext:{claims:[{id:'C-1',statement:'A+B+C 已完成',level:'confirmed',evidenceIds:['E-1'],scope:'general',coverage:'system',hops:[],obligationRefs:['O-1']}],gaps:[]},
  });

  assert.equal(modelCalls,0);
  assert.equal(result.assessments.length,1);
  assert.equal(result.assessments[0].certification,'supported');
  assert.deepEqual(result.assessments[0].proofFactRefs,['C-1']);
});
