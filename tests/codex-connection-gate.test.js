import test from 'node:test';
import assert from 'node:assert/strict';
import { CodexConnectionGate } from '../src/extensions/config/codex/codex-connection-gate.js';

test('connection gate prevents a reconfiguration from racing a newly admitted Turn',async()=>{
  const gate=new CodexConnectionGate();
  let releaseRun;
  const running=gate.run(()=>new Promise(resolve=>{releaseRun=resolve;}));
  assert.deepEqual(gate.snapshot(),{reconfiguring:false,activeRuns:1});
  assert.throws(()=>gate.beginReconfigure(),/EXECUTOR_CONNECTION_BUSY/);
  releaseRun('ok');
  assert.equal(await running,'ok');
  assert.deepEqual(gate.snapshot(),{reconfiguring:false,activeRuns:0});
});

test('connection gate atomically blocks new Turns during reconfiguration with capacity semantics',async()=>{
  const gate=new CodexConnectionGate();
  const release=gate.beginReconfigure();
  assert.deepEqual(gate.snapshot(),{reconfiguring:true,activeRuns:0});
  await assert.rejects(gate.run(async()=>1),error=>error?.capacityUnavailable===true);
  assert.throws(()=>gate.beginReconfigure(),/EXECUTOR_CONNECTION_BUSY/);
  release();
  assert.equal(await gate.run(async()=>2),2);
});

test('connection gate always releases an admitted Turn after failure',async()=>{
  const gate=new CodexConnectionGate();
  await assert.rejects(gate.run(async()=>{throw new Error('boom');}),/boom/);
  assert.deepEqual(gate.snapshot(),{reconfiguring:false,activeRuns:0});
  const release=gate.beginReconfigure();
  release();
});
