import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionAssessmentVerifier } from '../src/governance/completion-assessment-verifier.js';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';

test('Codex Validator receives the governed completion proof relation without becoming its owner',async()=>{
  const instruction='完成 A+B+C';
  const task={id:'T-proof',title:'proof',requirementSources:[{id:'REQ-1',text:instruction}],taskContract:{obligations:[{id:'O-1',certification:'supported',requirementRefs:[{sourceId:'REQ-1',start:0,end:instruction.length}],criterion:{mode:'outcome',acceptedOutcomes:['succeeded']}}]}};
  let candidate=null;
  const verifier=new CompletionAssessmentVerifier({executor:{async runValidator({candidates}){candidate=candidates[0];return{reviews:[{id:candidate.id,verdict:'overreach',reason:'partial proof'}]};}}});
  await verifier.review({task,proposal:{finalResult:'Root says all done'},certifiedContext:{evidence:[{id:'F-A',kind:'fact',statement:'A complete'}],claims:[],gaps:[]}});
  assert.ok(candidate);
  const executor=new CodexExecutor({runtimeRoot:'.taskboard-test-runtime',client:{}});
  const prompt=executor.validatorPrompt({task,policyContext:{prompt:'VALIDATOR POLICY'},candidates:[candidate]});
  assert.match(prompt,/"proofKind": "completion_obligation_support"/);
  assert.match(prompt,/proofMaterial Certified Facts alone satisfy the entire Criterion/);
  assert.match(prompt,/Completion proposal is the candidate claim under review; it is not proof/);
  assert.match(prompt,/Requirement provenance defines what is required and the governed Criterion; it is not completion evidence/);
  assert.match(prompt,/partial proof is overreach/);
  assert.match(prompt,/"certifiedFactRefs": \[\s*"F-A"/);
});
