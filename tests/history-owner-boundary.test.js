import test from 'node:test';
import assert from 'node:assert/strict';
import { ValidatorRuntime } from '../src/governance/validator-runtime.js';
import { applyCertifiedDelta, deriveHistoryFromTurn, emptyCertifiedState } from '../src/governance/certified-state.js';

test('Validator owns History semantic value while Task Core only carries an accepted candidate',()=>{
  const validator=new ValidatorRuntime();
  const decision={
    kind:'delegate',summary:'继续',stageResult:null,finalResult:null,resultMode:'analysis',
    evidence:[],
    claims:[{id:'C-HISTORY',level:'confirmed',statement:'已确认事实',scope:'component',evidenceIds:[]}],
    gaps:[],recommendations:[],steps:[],gapResolutions:[],delegations:[],gateway:null,
  };

  // A downstream Certified Turn must not invent History merely because it can
  // observe a Claim delta. Without Validator ownership there is no History.
  assert.equal(deriveHistoryFromTurn({delta:{claims:decision.claims,gaps:[],gapResolutions:[]}}),null);

  const progress=validator.deriveNewRootProgress(decision,new Set());
  assert.equal(progress.commits.length,1);
  assert.deepEqual(decision.__historyCommit,progress.commits[0]);

  const prepared=applyCertifiedDelta(emptyCertifiedState(),decision,{triggerRefs:['task:T-HISTORY']});
  assert.ok(prepared.turnNode);
  assert.deepEqual(deriveHistoryFromTurn(prepared.turnNode),progress.commits[0]);
});

test('Task Core refuses a Validator History candidate whose sources were not accepted into the Certified Delta',()=>{
  const decision={
    kind:'delegate',summary:'继续',stageResult:null,finalResult:null,resultMode:'analysis',
    evidence:[],
    claims:[{id:'C-ACCEPTED',level:'confirmed',statement:'已确认事实',scope:'component',evidenceIds:[]}],
    gaps:[],recommendations:[],steps:[],gapResolutions:[],delegations:[],gateway:null,
    __historyCommit:{title:'错误历史',detail:'引用未提交语义',sourceIds:['C-NOT-COMMITTED']},
  };
  const prepared=applyCertifiedDelta(emptyCertifiedState(),decision,{triggerRefs:['task:T-HISTORY']});
  assert.ok(prepared.turnNode);
  assert.equal(deriveHistoryFromTurn(prepared.turnNode),null);
});
