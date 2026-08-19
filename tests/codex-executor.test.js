import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexExecutor } from '../src/extensions/executors/codex/codex-executor.js';

const rootPolicy=()=>({prompt:'POLICY',skillCatalog:[],authorizedGrant:{role:'root',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none',environmentAccess:'none'}});
const subPolicy=({projectAccess='none',networkAccess=false,inputRefs=[]}={})=>({prompt:'POLICY',authorizedGrant:{role:'subagent',projectAccess,networkAccess,inputRefs,sourceAccess:inputRefs.length?'selected':'none',environmentAccess:'default'}});
class CaptureClient{constructor(){this.calls=[];}async runTurn(request){this.calls.push(request);return JSON.stringify({kind:'complete',summary:'ok',stageResult:'done',finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]});}async health(){return{available:true,connected:true,authenticated:true};}}

test('Codex Executor exposes only Root and Subagent model turns',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-two-role-'));try{const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client:new CaptureClient()});assert.equal(typeof executor.runRoot,'function');assert.equal(typeof executor.runSubagent,'function');assert.equal(typeof executor.runValidator,'undefined');assert.equal(typeof executor.validatorPrompt,'undefined');}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Codex executor health exposes Capability Provider refresh state',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-health-')),client=new CaptureClient(),capability={execution:{available:true,connected:true,ready:true,version:'codex-fake'},provider:{requiresOpenaiAuth:true,authMode:'chatgpt'},discoveryLevel:'partial',models:[],defaults:{model:'model-a'},catalogState:'stale',lastRefresh:{ok:false,error:'timeout'}};
  const capabilityProvider={async initialize(){return capability;},refreshState(){return{state:'manual_failed',lastRefresh:capability.lastRefresh};},snapshot(){return capability;}};
  try{const health=await new CodexExecutor({runtimeRoot:join(dir,'runtime'),client,capabilityProvider}).health();assert.equal(health.model,'model-a');assert.equal(health.catalogState,'stale');assert.equal(health.modelRefresh.state,'manual_failed');}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Root sees input metadata but receives no local file/network capability',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-root-')),image=join(dir,'screen.png'),doc=join(dir,'spec.txt'),client=new CaptureClient();writeFileSync(image,Buffer.from([1,2,3]));writeFileSync(doc,'spec');
  try{const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client});await executor.runRoot({task:{id:'T',title:'分析附件',instruction:'分析',projectScopes:[],references:[],last_stage_result:null,attachments:[{id:'A-1',name:'screen.png',mimeType:'image/png',size:3,path:image},{id:'A-2',name:'spec.txt',mimeType:'text/plain',size:4,path:doc}]},subagentResults:[],humanGatewayHistory:[],certifiedContext:{claims:[],gaps:[],unresolvedObligations:[]},modelPolicy:{},policyContext:rootPolicy()});const call=client.calls[0];assert.deepEqual(call.inputItems,[]);assert.equal(call.networkAccess,false);assert.match(call.prompt,/screen\.png/);assert.match(call.prompt,/spec\.txt/);assert.doesNotMatch(call.prompt,new RegExp(image.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));assert.doesNotMatch(call.prompt,new RegExp(doc.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Root prompt is a closure boundary, not a repair/replay boundary',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-closure-'));try{const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client:new CaptureClient()}),prompt=executor.rootPrompt({task:{id:'T',title:'x',instruction:'goal',projectScopes:[],attachments:[],references:[],workReceipts:[],last_stage_result:null},subagentResults:[{delegationId:'WU-1',result:'fresh',evidence:[]}],humanGatewayHistory:[],policyContext:rootPolicy(),certifiedContext:{claims:[{id:'C-OLD'}],gaps:[{id:'G-1'}],unresolvedObligations:[{id:'O-2'}]}});assert.match(prompt,/fixed point/i);assert.match(prompt,/old×old, new×old, and new×new/i);assert.match(prompt,/Fresh Work Unit result delta/);assert.match(prompt,/Current semantic grid/);assert.doesNotMatch(prompt,/VALIDATOR FEEDBACK|WORK PLAN REPAIR|Previous candidate|Completed Work Receipts/);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Project access belongs only to explicit Subagent Work Units',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-scope-')),project=join(dir,'project');mkdirSync(project);const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client:new CaptureClient()});
  try{const task={id:'T',projectScopes:[{path:project}]},root=executor.executionScope(task,rootPolicy());assert.equal(root.projectAccess,'none');assert.equal(root.runtimeWorkspaceRoots.includes(project),false);const read=executor.executionScope(task,subPolicy({projectAccess:'read',inputRefs:['project:0']}),{workUnitId:'read'});assert.equal(read.runtimeWorkspaceRoots.includes(project),true);assert.deepEqual(read.writableRoots,[]);const write=executor.executionScope(task,subPolicy({projectAccess:'write',inputRefs:['project:0']}),{workUnitId:'write'});assert.equal(write.writableRoots.includes(project),true);assert.throws(()=>executor.executionScope(task,{authorizedGrant:{role:'validator'}}),/AUTHORIZED_GRANT_ROLE_INVALID/);assert.equal(executor.cleanupTaskWorkspace(task.id),true);assert.equal(existsSync(root.cwd),false);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Subagent receives one Executor-owned environment snapshot',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-env-'));let probes=0;const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client:new CaptureClient(),environmentProbe:()=>{probes+=1;return{checkedAt:'now',rg:false,python:'python',pythonModules:{pdf2image:false,lxml:false},libreOffice:false,wordDesktopBinary:false};}});
  try{const task={id:'T',title:'附件分析',projectScopes:[],attachments:[],references:[]},delegation={id:'W',title:'W',goal:'核对',expectedOutput:'证据',stopCondition:'完成',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},first=executor.subagentPrompt({task,delegation}),second=executor.subagentPrompt({task,delegation});assert.equal(probes,1);assert.match(first,/Executor Environment Snapshot/);assert.match(first,/"rg":false/);assert.match(second,/do not re-probe/i);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Executor realizes AuthorizedGrant exactly or rejects unavailable capability',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-network-')),task={id:'T',title:'network',projectScopes:[],attachments:[],references:[]},delegation={id:'W',title:'W',goal:'net',expectedOutput:'result',stopCondition:'done',projectAccess:'none',networkAccess:true,skillId:null,dependsOn:[],inputRefs:[]};
  try{const allowedClient=new CaptureClient(),allowed=new CodexExecutor({runtimeRoot:join(dir,'allowed'),client:allowedClient,networkAccess:true});await allowed.runSubagent({task,delegation,policyContext:subPolicy({networkAccess:true}),modelPolicy:{}});assert.equal(allowedClient.calls[0].networkAccess,true);const deniedClient=new CaptureClient(),denied=new CodexExecutor({runtimeRoot:join(dir,'denied'),client:deniedClient,networkAccess:false});await assert.rejects(denied.runSubagent({task,delegation,policyContext:subPolicy({networkAccess:true}),modelPolicy:{}}),error=>error?.runtimeUnavailable===true&&/RUNTIME_CAPABILITY_UNAVAILABLE/.test(error.message));assert.equal(deniedClient.calls.length,0);}finally{rmSync(dir,{recursive:true,force:true});}
});

test('Recovery context exposes only minimum unresolved effect facts to Root',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-recovery-')),client=new CaptureClient(),executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client});
  try{await executor.runRoot({task:{id:'T',title:'recover',instruction:'核对现实',projectScopes:[],attachments:[],references:[],last_stage_result:null,executionState:{recovery:{effectAttempts:[{id:'effect:1',workUnitId:'WU-OLD',signature:'must-not-leak',projectAccess:'write',networkAccess:false,inputRefs:['project:0'],admittedAt:'now',reason:'effect-capable-work-admitted',resolved:false}]},retry:{scope:'effect-recovery-observe'}}},subagentResults:[],humanGatewayHistory:[],certifiedContext:{claims:[],gaps:[],unresolvedObligations:[]},modelPolicy:{},policyContext:rootPolicy()});const prompt=client.calls[0].prompt;assert.match(prompt,/RECOVERY OBSERVATION BOUNDARY/);assert.match(prompt,/effect outcome is UNKNOWN/i);assert.match(prompt,/Do not replay the old Work/i);assert.match(prompt,/WU-OLD/);assert.doesNotMatch(prompt,/must-not-leak/);}finally{rmSync(dir,{recursive:true,force:true});}
});
