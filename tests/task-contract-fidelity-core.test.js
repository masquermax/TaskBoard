import test from 'node:test';
import assert from 'node:assert/strict';
import { FidelityCertification, TaskContractFidelityVerifier, applyAuthorityFidelity, createAuthoritySemanticCandidate, resolveRequirementRefs } from '../src/governance/task-contract-fidelity.js';

const task=text=>({id:'T',title:'T',requirementSources:[{id:'REQ',text}]});
const ref=(text,fragment)=>{const start=text.indexOf(fragment);return{sourceId:'REQ',start,end:start+fragment.length};};
const executor=fn=>({async runValidator({candidates}){return{reviews:candidates.map(candidate=>({id:candidate.id,verdict:fn(candidate),reason:candidate.proofKind}))};}});

test('immutable requirement refs resolve exact spans',()=>{const text='可以读取项目。不要修改数据库。';const out=resolveRequirementRefs(task(text).requirementSources,[ref(text,'不要修改数据库')]);assert.equal(out.valid,true);assert.equal(out.excerpts[0].text,'不要修改数据库');assert.equal(resolveRequirementRefs(task(text).requirementSources,[{sourceId:'missing',start:0,end:1}]).valid,false);});

test('semantic value is independent from certification',async()=>{const text='不要修改数据库。';const candidate=createAuthoritySemanticCandidate({id:'db',key:'dbMutation',value:'forbidden',requirementRefs:[ref(text,text)]});const verifier=new TaskContractFidelityVerifier({executor:executor(c=>c.proofKind.endsWith('support')?'supported':'overreach')});const out=await verifier.review({task:task(text),candidates:[candidate]});assert.equal(out.reviews[0].certification,FidelityCertification.SUPPORTED);const contract=applyAuthorityFidelity({id:'TC',revision:1,authority:{}},[candidate],out.reviews);assert.equal(contract.authority.dbMutation.value,'forbidden');assert.equal(contract.authority.dbMutation.certification,'supported');});

test('supported read stays certified when write remains unresolved',async()=>{const text='请检查当前项目实现';const candidates=[createAuthoritySemanticCandidate({id:'read',key:'projectRead',value:'allowed',requirementRefs:[ref(text,text)]}),createAuthoritySemanticCandidate({id:'write',key:'projectMutation',value:'allowed',requirementRefs:[ref(text,text)]})];const verifier=new TaskContractFidelityVerifier({executor:executor(c=>c.targetId==='read'&&c.proofKind.endsWith('support')?'supported':'overreach')});const out=await verifier.review({task:task(text),candidates});const byId=new Map(out.reviews.map(item=>[item.id,item.certification]));assert.equal(byId.get('read'),'supported');assert.equal(byId.get('write'),'unresolved');});
