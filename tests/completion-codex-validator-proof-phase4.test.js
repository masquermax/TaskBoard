import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';

test('Codex Validator treats completion proposal and Requirement as context, never Completion proof',()=>{
  const executor=new CodexExecutor({runtimeRoot:'.taskboard-test-runtime',client:{}});
  const prompt=executor.validatorPrompt({
    task:{id:'T-proof',title:'proof'},
    policyContext:{prompt:'VALIDATOR POLICY'},
    candidates:[{
      id:'completion:O-1',
      targetId:'O-1',
      candidateType:'completion_assessment',
      proofKind:'completion_obligation_support',
      criterion:{mode:'outcome',acceptedOutcomes:['succeeded']},
      requirementContext:[{sourceId:'REQ-1',start:0,end:10,text:'完成 A+B+C'}],
      proposal:{finalResult:'Root says all done'},
      proofMaterial:[{id:'F-A',statement:'A complete'}],
    }],
  });
  assert.match(prompt,/proofKind=completion_obligation_support/);
  assert.match(prompt,/proofMaterial.*Certified Facts/i);
  assert.match(prompt,/proposal.*candidate.*not.*proof/i);
  assert.match(prompt,/requirementContext.*criterion.*not.*completion evidence/i);
  assert.match(prompt,/supported only when.*proofMaterial.*satisfy.*criterion/i);
  assert.match(prompt,/partial.*overreach/i);
});
