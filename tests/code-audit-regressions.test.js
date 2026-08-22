import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { RootRuntime, validateDelegationPlan } from '../src/core/root-runtime.js';
import { ExecutorRuntimeAdapter } from '../src/core/executor-runtime.js';
import { ModelRouter } from '../src/core/model-router.js';
import { SubagentRuntime } from '../src/core/subagent-runtime.js';
import { AttachmentStore } from '../src/core/attachment-store.js';
import { JsonTaskDatabase, JsonTaskRepository } from '../src/core/json-repository.js';
import { TaskService } from '../src/core/task-service.js';
import { TestExecutor as MockExecutor } from './helpers/test-executor.js';
import { createApp } from '../src/server/app.js';

function runtime(executor={}){const router=new ModelRouter();return new RootRuntime({executor,modelRouter:router,subagentRuntime:new SubagentRuntime({executor,modelRouter:router})});}

test('delegation plan validates Work identity/dependencies without confusing Work count with concurrency',()=>{
  const work=id=>({id,title:id,goal:id,expectedOutput:`${id} result`,stopCondition:`${id} done`,projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]});
  const many=['a','b','c','d','e'].map(work);many.push({...work('f'),dependsOn:['e']});
  assert.equal(validateDelegationPlan(many).valid,true);
  const duplicate=validateDelegationPlan([work('dup'),work('dup')]);assert.equal(duplicate.valid,false);assert.match(duplicate.issues.join(' '),/id 重复/);
  const unknown=validateDelegationPlan([{...work('a'),dependsOn:['missing']}]);assert.equal(unknown.valid,false);assert.match(unknown.issues.join(' '),/依赖不存在/);
  const cycle=validateDelegationPlan([{...work('a'),dependsOn:['b']},{...work('b'),dependsOn:['a']}]);assert.equal(cycle.valid,false);assert.match(cycle.issues.join(' '),/循环/);
});

test('attachment cleanup uses a path boundary, not a shared string prefix',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-attachment-boundary-')),root=join(dir,'attachments'),outside=join(dir,'attachments-escape');mkdirSync(root);mkdirSync(outside);const outsideFile=join(outside,'keep.txt');writeFileSync(outsideFile,'keep');
  try{const store=new AttachmentStore({rootDir:root});assert.equal(store.owns(outsideFile),false);store.removeTaskAttachments([{path:outsideFile}]);assert.equal(existsSync(outsideFile),true);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('HTTP rejects malformed JSON and encoded static path traversal',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-http-audit-')),db=new JsonTaskDatabase(join(dir,'db.json')),repo=new JsonTaskRepository(db),service=new TaskService(repo),server=createServer(createApp({taskService:service,executor:new MockExecutor(),uiRoot:resolve('src/ui')}));await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{const malformed=await fetch(`${base}/api/tasks`,{method:'POST',headers:{'content-type':'application/json','x-taskboard-action':'ui'},body:'{"title":'});assert.equal(malformed.status,400);assert.equal((await malformed.json()).error,'INVALID_JSON');const traversalStatus=await new Promise((resolveStatus,reject)=>{const req=httpRequest({host:'127.0.0.1',port:server.address().port,path:'/%2e%2e/%2e%2e/etc/passwd',method:'GET'},res=>{res.resume();res.on('end',()=>resolveStatus(res.statusCode));});req.on('error',reject);req.end();});assert.equal(traversalStatus,404);}finally{await new Promise(r=>server.close(r));db.close();rmSync(dir,{recursive:true,force:true});}
});

test('Subagent returns raw execution evidence but no Task-level interpretation fields',async()=>{
  const executor={async runSubagent(){return{delegationId:'d',result:'local result',evidence:[{id:'E-1',strength:'direct',kind:'fact',sourceType:'project_file',coverage:'component',statement:'存在字段',basis:'A.java',locator:'A.java',observation:'存在字段'}],findings:[{id:'F-1'}],discoveries:[{id:'D-1'}],uncertainty:'maybe',blocker:null};}},router=new ModelRouter(),subagent=new SubagentRuntime({executor,modelRouter:router,sourceTraceVerifier:{enforce(){throw new Error('ordinary source verification belongs to Validator');}}});
  const result=await subagent.run({id:'T-1',projectScopes:[],attachments:[],references:[]},{id:'d',title:'查证',goal:'核对字段',expectedOutput:'字段证据',stopCondition:'返回后停止',projectAccess:'none',networkAccess:false,inputRefs:[],skillId:null,dependsOn:[]});
  assert.equal(result.evidence[0].strength,'direct');for(const key of ['findings','discoveries','uncertainty','claims','gaps','recommendations'])assert.equal(key in result,false,key);
});

test('ModelRouter releases per-task capability cache when execution session is discarded',()=>{const router=new ModelRouter();router.prepared.set('T-1',{x:1});router.release('T-1');assert.equal(router.prepared.has('T-1'),false);});

test('invalid Root delegation graph fails at the deterministic contract boundary without a repair turn',async()=>{
  let turns=0,subagentCalls=0;
  const executor={async runRoot(){turns+=1;return{kind:'delegate',summary:'bad plan',finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[{id:'a',title:'A',goal:'A',expectedOutput:'A',stopCondition:'done',projectAccess:'none',networkAccess:false,inputRefs:[],skillId:null,dependsOn:['b']},{id:'b',title:'B',goal:'B',expectedOutput:'B',stopCondition:'done',projectAccess:'none',networkAccess:false,inputRefs:[],skillId:null,dependsOn:['a']}]};},async runSubagent(){subagentCalls+=1;}};
  await assert.rejects(runtime(executor).execute({id:'T-plan',title:'执行',instruction:'执行任务',projectScopes:[],attachments:[],references:[]}),/ROOT_INVALID_DELEGATION_PLAN/);
  assert.equal(turns,1);assert.equal(subagentCalls,0);
});

test('Mock Executor validates control flow without manufacturing business Evidence',async()=>{
  const runtimeExecutor=new ExecutorRuntimeAdapter(new MockExecutor());
  const root=await runtimeExecutor.runRoot({task:{id:'T-MOCK',title:'明确任务',instruction:'执行',projectScopes:[],attachments:[],references:[]},humanGatewayHistory:[],policyContext:{authorizedGrant:{role:'root',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',environmentAccess:'none'}}});
  const sub=await runtimeExecutor.runSubagent({task:{id:'T-MOCK',title:'明确任务',instruction:'',projectScopes:[],attachments:[],references:[]},delegation:{id:'WU-1',title:'测试工作',goal:'测试',expectedOutput:'结果',stopCondition:'完成',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},policyContext:{authorizedGrant:{role:'subagent',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',environmentAccess:'default'}}});
  assert.deepEqual(root.evidence,[]);assert.deepEqual(root.claims,[]);assert.deepEqual(sub.evidence,[]);for(const key of ['claims','gaps','recommendations'])assert.equal(key in sub,false);
});

test('current Runtime contains no removed role/domain entry outside migration boundaries',()=>{
  const allowed=new Set(['src/core/runtime-settings.js','src/core/runtime-state-migration.js','src/core/retry-policy.js']),files=[];const walk=dir=>{for(const entry of readdirSync(resolve(dir),{withFileTypes:true})){const path=`${dir}/${entry.name}`;if(entry.isDirectory())walk(path);else if(entry.isFile()&&path.endsWith('.js'))files.push(path);}};walk('src');
  const forbidden=/SystemFilter|\bOUTSIDE\b|temporaryPath|taskMaxThreads|workerConcurrency|runLead|runWorker|LeadRuntime|WorkerRuntime|ExecutionAdapterPort|ownerLabel|ownerType|RESOURCE_WAIT|pendingSubagentValidation|reviewSubagent|resumeValidation|workerExecutionWindowMs|\bWorker\b|\bworker\b/;
  for(const file of files){if(allowed.has(file))continue;assert.doesNotMatch(readFileSync(resolve(file),'utf8'),forbidden,`legacy current-domain entry leaked into ${file}`);}
});
