import test from 'node:test';
import assert from 'node:assert/strict';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';

function work(){return{id:'WU-B',title:'B',goal:'consume A',expectedOutput:'bounded result',stopCondition:'result returned',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:['WU-A'],inputRefs:[],dependencyResults:[{id:'WU-A',result:{delegationId:'WU-A',result:'blocked',evidence:[],blocker:'SOURCE_UNAVAILABLE'}}]};}

test('a blocked prerequisite stops only its dependent Work Unit before any model/tool turn',async()=>{
  let prepared=0,executed=0;
  const runtime=new SubagentRuntime({
    executor:{async runSubagent(){executed+=1;throw new Error('must not execute');}},
    modelRouter:{async prepare(){prepared+=1;},route(){return{};}},
  });
  const result=await runtime.run({id:'T',projectScopes:[],attachments:[],references:[]},work());
  assert.equal(prepared,0);
  assert.equal(executed,0);
  assert.equal(result.delegationId,'WU-B');
  assert.match(result.blocker,/WORK_UNIT_DEPENDENCY_UNSATISFIED/);
  assert.deepEqual(result.evidence,[]);
});
