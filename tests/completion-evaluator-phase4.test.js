import test from 'node:test';
import assert from 'node:assert/strict';
import { CompletionEvaluator, GoalState } from '../src/governance/completion-evaluator.js';

const evaluator=new CompletionEvaluator();
function task(ids=['O-A','O-B']){const text='goal';return{id:'T-1',requirementSources:[{id:'REQ-T-1-0001',text}],taskContract:{obligations:ids.map(id=>({id,certification:'supported',requirementRefs:[{sourceId:'REQ-T-1-0001',start:0,end:text.length}]}))}};}
function claim(id,refs=[],level='confirmed'){return{id,statement:id,level,evidenceIds:[`E-${id}`],scope:'general',coverage:'component',hops:[],obligationRefs:refs};}
function evaluate({ids=['O-A','O-B'],claims=[],finalResult='done'}={}){return evaluator.evaluate({task:task(ids),proposal:{finalResult},certifiedContext:{claims,gaps:[]}});}

test('only explicit CONFIRMED Root mappings satisfy their obligations',()=>{
  const result=evaluate({claims:[claim('C-A',['O-A'])]});
  assert.equal(result.goalState,GoalState.UNSATISFIED);
  assert.deepEqual(result.satisfiedObligationIds,['O-A']);
  assert.deepEqual(result.unsatisfiedObligationIds,['O-B']);
});

test('one confirmed Claim may explicitly satisfy multiple obligations',()=>{
  const result=evaluate({claims:[claim('C-AB',['O-A','O-B'])]});
  assert.equal(result.goalState,GoalState.SATISFIED);
});

test('SUPPORTED inference and empty proposal never become completion truth',()=>{
  assert.equal(evaluate({ids:['O-A'],claims:[claim('C-I',['O-A'],'supported')]}).goalState,GoalState.UNSATISFIED);
  assert.equal(evaluate({ids:['O-A'],claims:[claim('C-A',['O-A'])],finalResult:''}).goalState,GoalState.UNSATISFIED);
});

test('untrusted or malformed obligation provenance remains unsatisfied',()=>{
  const current=task(['O-A']);current.taskContract.obligations[0].requirementRefs=[{sourceId:'MISSING',start:0,end:1}];
  const result=evaluator.evaluate({task:current,proposal:{finalResult:'done'},certifiedContext:{claims:[claim('C-A',['O-A'])]}});
  assert.equal(result.goalState,GoalState.UNSATISFIED);
});
