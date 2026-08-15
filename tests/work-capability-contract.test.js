import test from 'node:test';
import assert from 'node:assert/strict';
import { capabilitiesSatisfy, requiredWorkCapabilities, validateWorkCapabilityContract } from '../src/core/work-capability.js';

test('D-019: required Work semantics are distinct from requested and granted capability',()=>{
  const requiredWrite={projectAccess:'write',networkAccess:false,requiredCapabilities:{projectAccess:'write',networkAccess:false}};
  const contract=validateWorkCapabilityContract(requiredWrite);
  assert.deepEqual(contract.issues,[]);
  assert.equal(capabilitiesSatisfy(requiredWorkCapabilities(requiredWrite),{projectAccess:'read',networkAccess:false}),false,
    'an allowed read grant cannot silently redefine work that requires write');
  assert.equal(capabilitiesSatisfy(requiredWorkCapabilities(requiredWrite),{projectAccess:'write',networkAccess:false}),true);

  const optionalWriteRequest={projectAccess:'write',networkAccess:false,requiredCapabilities:{projectAccess:'read',networkAccess:false}};
  assert.deepEqual(validateWorkCapabilityContract(optionalWriteRequest).issues,[]);
  assert.equal(capabilitiesSatisfy(requiredWorkCapabilities(optionalWriteRequest),{projectAccess:'read',networkAccess:false}),true,
    'a broad request may be narrowed when the authored work semantics require only read');
});

test('D-019: required capability cannot exceed the Work Unit capability request',()=>{
  const invalid={projectAccess:'read',networkAccess:false,requiredCapabilities:{projectAccess:'write',networkAccess:true}};
  const {issues}=validateWorkCapabilityContract(invalid);
  assert.equal(issues.length,2);
});
