import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilitiesSatisfy, requiredWorkCapabilities } from '../src/core/work-capability.js';

test('D-019: Work Unit capability request is the minimum capability required by its authored semantics',()=>{
  const writeWork={projectAccess:'write',networkAccess:false};
  assert.deepEqual(requiredWorkCapabilities(writeWork),{projectAccess:'write',networkAccess:false});
  assert.equal(capabilitiesSatisfy(requiredWorkCapabilities(writeWork),{projectAccess:'read',networkAccess:false}),false,
    'an allowed read grant cannot silently redefine work that requires write');
  assert.equal(capabilitiesSatisfy(requiredWorkCapabilities(writeWork),{projectAccess:'write',networkAccess:false}),true);
});

test('D-019: network requirement cannot be silently weakened by the realized capability',()=>{
  const networkWork={projectAccess:'none',networkAccess:true};
  assert.equal(capabilitiesSatisfy(requiredWorkCapabilities(networkWork),{projectAccess:'none',networkAccess:false}),false);
  assert.equal(capabilitiesSatisfy(requiredWorkCapabilities(networkWork),{projectAccess:'none',networkAccess:true}),true);
});
