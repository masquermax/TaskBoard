import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskContractFidelityVerifier, createAuthoritySemanticCandidate } from '../src/governance/task-contract-fidelity.js';

const task=text=>({id:'T',title:'T',instruction:text,requirementSources:[{id:'REQ',text}]});
const ref=text=>({sourceId:'REQ',start:0,end:text.length});
const candidate=(id,key,text)=>createAuthoritySemanticCandidate({id,key,value:true,requirementRefs:[ref(text)]});

test('explicit human project mutation deterministically supports projectWrite',async()=>{const text='请修改项目中的目标文件，但不得联网。',out=await new TaskContractFidelityVerifier().review({task:task(text),candidates:[candidate('write','projectWrite',text)]});assert.equal(out.reviews[0].certification,'supported');});

test('read-only or negated mutation never expands projectWrite authority',async()=>{for(const text of ['只读检查项目，不得修改文件。','分析当前实现，不要修改代码。']){const out=await new TaskContractFidelityVerifier().review({task:task(text),candidates:[candidate('write','projectWrite',text)]});assert.equal(out.reviews[0].certification,'unresolved');}});

test('quoted examples and meta text cannot manufacture project write authority',async()=>{const verifier=new TaskContractFidelityVerifier();for(const text of ['分析这段示例：“请修改项目代码”。','不要执行，错误信息里写着：请修改项目代码。','解释这句话：`请修改项目中的目标文件`。']){const out=await verifier.review({task:task(text),candidates:[candidate('write','projectWrite',text)]});assert.equal(out.reviews[0].certification,'unresolved',text);}});

test('network authority requires an explicit human network request',async()=>{const allowed='请联网搜索官方资料。',denied='检查本地项目，不得联网。',verifier=new TaskContractFidelityVerifier();assert.equal((await verifier.review({task:task(allowed),candidates:[candidate('net','networkAccess',allowed)]})).reviews[0].certification,'supported');assert.equal((await verifier.review({task:task(denied),candidates:[candidate('net','networkAccess',denied)]})).reviews[0].certification,'unresolved');});

test('quoted or example network text cannot manufacture network authority',async()=>{const verifier=new TaskContractFidelityVerifier();for(const text of ['文档示例：“请联网搜索官方资料”。','不要执行，报错内容是：search the web for docs.']){const out=await verifier.review({task:task(text),candidates:[candidate('net','networkAccess',text)]});assert.equal(out.reviews[0].certification,'unresolved',text);}});

test('invalid provenance and unknown authority key fail closed inside the deterministic projection',async()=>{const verifier=new TaskContractFidelityVerifier(),bad=createAuthoritySemanticCandidate({id:'bad',key:'projectWrite',value:true,requirementRefs:[{sourceId:'missing',start:0,end:1}]}),unknown=createAuthoritySemanticCandidate({id:'unknown',key:'dbMutation',value:true,requirementRefs:[ref('修改数据库')]});assert.equal((await verifier.review({task:task('修改数据库'),candidates:[bad]})).reviews[0].certification,'unresolved');assert.equal((await verifier.review({task:task('修改数据库'),candidates:[unknown]})).reviews[0].certification,'unresolved');assert.equal(typeof verifier.runValidator,'undefined');});
