import test from 'node:test';
import assert from 'node:assert/strict';
import { compileAuthorizedGrant } from '../src/governance/governance-compiler.js';

test('Validator has no Executor grant or Codex transport mapping',()=>{
  const task={id:'T-TRANSPORT',title:'source ledger',instruction:'verify provenance',projectScopes:[{path:'/project'}],attachments:[],references:[]};
  assert.throws(()=>compileAuthorizedGrant({role:'validator',task}),/ROLE_NOT_EXECUTABLE:validator/);
});

test('Root grant remains scratch-only and carries no Project/network authority',()=>{
  const task={id:'T-TRANSPORT',title:'Root scope isolation',instruction:'Read-only source analysis',projectScopes:[{path:'/project'}],attachments:[],references:[],taskContract:{authority:{}}};
  const grant=compileAuthorizedGrant({role:'root',task});
  assert.deepEqual(grant,{role:'root',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',environmentAccess:'none'});
});
