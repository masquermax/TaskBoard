import test from 'node:test';
import assert from 'node:assert/strict';
import { FidelityCertification, TaskContractFidelityVerifier, applyAuthorityFidelity, createAuthoritySemanticCandidate, resolveRequirementRefs } from '../src/governance/task-contract-fidelity.js';

const task=text=>({id:'T',title:'T',instruction:text,requirementSources:[{id:'REQ',text}]});
const ref=(text,fragment=text)=>{const start=text.indexOf(fragment);return{sourceId:'REQ',start,end:start+fragment.length};};

test('immutable requirement refs resolve exact spans',()=>{
  const text='可以读取项目。不要修改数据库。';
  const out=resolveRequirementRefs(task(text).requirementSources,[ref(text,'不要修改数据库')]);
  assert.equal(out.valid,true);
  assert.equal(out.excerpts[0].text,'不要修改数据库');
  assert.equal(resolveRequirementRefs(task(text).requirementSources,[{sourceId:'missing',start:0,end:1}]).valid,false);
});

test('projectWrite is supported only by an explicit human mutation requirement',async()=>{
  const text='请修改项目中的目标文件。';
  const candidate=createAuthoritySemanticCandidate({id:'write',key:'projectWrite',value:true,requirementRefs:[ref(text)]});
  const verifier=new TaskContractFidelityVerifier();
  const out=await verifier.review({task:task(text),candidates:[candidate]});
  assert.equal(out.reviews[0].certification,FidelityCertification.SUPPORTED);
  const contract=applyAuthorityFidelity({id:'TC',revision:1,authority:{}},[candidate],out.reviews);
  assert.equal(contract.authority.projectWrite.value,true);
  assert.equal(contract.authority.projectWrite.certification,'supported');
});

test('ambiguous requirement cannot manufacture capability authority',async()=>{
  const text='检查当前项目实现。';
  const candidates=[
    createAuthoritySemanticCandidate({id:'write',key:'projectWrite',value:true,requirementRefs:[ref(text)]}),
    createAuthoritySemanticCandidate({id:'network',key:'networkAccess',value:true,requirementRefs:[ref(text)]}),
  ];
  const out=await new TaskContractFidelityVerifier().review({task:task(text),candidates});
  assert.deepEqual(out.reviews.map(item=>item.certification),['unresolved','unresolved']);
});

test('authority projection is deterministic and never invokes Validator model',async()=>{
  let calls=0;
  const text='请联网搜索官方资料。';
  const candidate=createAuthoritySemanticCandidate({id:'network',key:'networkAccess',value:true,requirementRefs:[ref(text)]});
  const verifier=new TaskContractFidelityVerifier({executor:{async runValidator(){calls+=1;throw new Error('MODEL_MUST_NOT_RUN');}}});
  const out=await verifier.review({task:task(text),candidates:[candidate]});
  assert.equal(out.reviews[0].certification,'supported');
  assert.equal(calls,0);
});
