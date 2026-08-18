import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { closeAndDrainClient } from '../src/extensions/config/codex/codex-connection-settings.js';

function liveChild() {
  const child=new EventEmitter();
  child.exitCode=null;
  return child;
}

test('profile switching drains the prior app-server child even when the mode-sensitive top-level child getter hides it',async()=>{
  const oldAppServerChild=liveChild();
  let closed=false;
  let exited=false;
  const client={
    // Simulate the profile value already pointing at the candidate custom mode:
    // CodexTransportClient.child would now expose execClient.child, not the old
    // account app-server child that still has to be drained.
    child:null,
    appServerClient:{child:oldAppServerChild},
    execClient:{child:null,children:new Set()},
    close(){
      closed=true;
      setImmediate(()=>{
        oldAppServerChild.exitCode=0;
        exited=true;
        oldAppServerChild.emit('exit',0);
      });
    },
  };

  await closeAndDrainClient(client);
  assert.equal(closed,true);
  assert.equal(exited,true,'restart must not open the next transport before the hidden previous child exits');
});

test('profile switching drains every live custom exec child captured before close',async()=>{
  const first=liveChild();
  const second=liveChild();
  const exited=new Set();
  const client={
    child:null,
    appServerClient:{child:null},
    execClient:{child:first,children:new Set([first,second])},
    close(){
      setImmediate(()=>{first.exitCode=0;exited.add('first');first.emit('exit',0);});
      setImmediate(()=>{second.exitCode=0;exited.add('second');second.emit('exit',0);});
    },
  };

  await closeAndDrainClient(client);
  assert.deepEqual([...exited].sort(),['first','second']);
});
