import { readFileSync, writeFileSync } from 'node:fs';

function edit(path, transform){
  const before=readFileSync(path,'utf8');
  const after=transform(before);
  if(after===before)throw new Error(`patch made no change: ${path}`);
  writeFileSync(path,after);
}
function replaceOnce(text, search, replacement, label){
  const index=text.indexOf(search);
  if(index<0)throw new Error(`missing patch anchor: ${label}`);
  if(text.indexOf(search,index+search.length)>=0)throw new Error(`ambiguous patch anchor: ${label}`);
  return text.slice(0,index)+replacement+text.slice(index+search.length);
}

// Completion coverage must survive Human Gateway/session replacement. A certified
// Root turn triggered by a Work Unit result is durable evidence that delegated
// source work reached Task cognition; session-local issuedWorkSignatures are not.
edit('src/core/root-runtime.js', text=>replaceOnce(
  text,
  "      const hasIssuedSourceWork=session.issuedWorkSignatures.size>0||session.completedWorkUnits.length>0||rootInputs.length>0;",
  "      const hasCertifiedWorkTrigger=(session.analysisState?.turns||[]).some(turn=>(turn?.triggerRefs||[]).some(ref=>String(ref||'').startsWith('work:')));\n      const hasIssuedSourceWork=session.issuedWorkSignatures.size>0||session.completedWorkUnits.length>0||rootInputs.length>0||hasCertifiedWorkTrigger;",
  'durable source-work completion coverage',
));

// Selected attachments are copied into the role/Work Unit scratch. Runtime never
// grants the shared attachment bundle directory, which would expose unselected files.
edit('src/extensions/executors/codex/codex-executor.js', text=>{
  text=replaceOnce(text,"import { mkdirSync, rmSync } from 'node:fs';","import { copyFileSync, mkdirSync, rmSync } from 'node:fs';",'attachment copy import');
  const anchor="  attachmentInputs(task){return(task.attachments||[]).filter(isSupportedLocalImage).map(a=>({type:'localImage',path:a.path}));}";
  const replacement=`  stageSelectedAttachments(task,scratch,attachments=task.attachments||[]){
    const selected=(Array.isArray(attachments)?attachments:[]).filter(item=>item?.path&&existsSync(item.path));
    if(!selected.length)return{...task,attachments:[]};
    const inputDir=resolve(scratch,'inputs');mkdirSync(inputDir,{recursive:true});
    const staged=selected.map((attachment,index)=>{
      const safe=String(attachment.id||attachment.name||index+1).replace(/[^A-Za-z0-9._-]/g,'_');
      const target=resolve(inputDir,\`${'${index+1}'}-\${safe}\${extname(attachment.name||attachment.path||'')}\`);
      copyFileSync(attachment.path,target);
      return{...attachment,path:target};
    });
    return{...task,attachments:staged};
  }
  attachmentInputs(task){return(task.attachments||[]).filter(isSupportedLocalImage).map(a=>({type:'localImage',path:a.path}));}`;
  text=replaceOnce(text,anchor,replacement,'selected attachment staging');

  const oldSub=/  async runSubagent\(request\)\{const scope=this\.executionScope\(request\.task,request\.policyContext,\{workUnitId:request\.delegation\?\.id\}\);const text=await this\.client\.runTurn\(\{\.\.\.scope,prompt:this\.subagentPrompt\(request\),inputItems:this\.attachmentInputs\(request\.task\),outputSchema:subagentSchema,[^\n]+\n/;
  if(!oldSub.test(text))throw new Error('missing patch anchor: staged runSubagent');
  text=text.replace(oldSub,`  async runSubagent(request){const scope=this.executionScope(request.task,request.policyContext,{workUnitId:request.delegation?.id});const stagedTask=this.stageSelectedAttachments(request.task,scope.scratch);const text=await this.client.runTurn({...scope,prompt:this.subagentPrompt({...request,task:stagedTask}),inputItems:this.attachmentInputs(stagedTask),outputSchema:subagentSchema,model:request.modelPolicy?.model||null,reasoningEffort:request.modelPolicy?.reasoningEffort||null,onProgress:request.onProgress||null,onExecutionStarted:request.onExecutionStarted||null,signal:request.signal||null,stopCondition:request.delegation?.stopCondition||null,diagnosticContext:{taskId:request.task?.id||null,workUnitId:request.delegation?.id||null,role:'subagent',projectAccess:scope.projectAccess,networkAccess:scope.networkAccess,routeReason:request.modelPolicy?.routeReason||null,configuredDefaultModel:request.modelPolicy?.configuredDefaultModel||null}});return safeParse(text);}
`);

  const oldValidator=/  async runValidator\(request\)\{const scope=this\.executionScope\(request\.task,request\.policyContext,\{workUnitId:null\}\);const text=await this\.client\.runTurn\(\{\.\.\.scope,prompt:this\.validatorPrompt\(request\),inputItems:this\.validatorAttachmentInputs\(request\.task,request\.candidates\),outputSchema:validatorSchema,[^\n]+\n/;
  if(!oldValidator.test(text))throw new Error('missing patch anchor: staged runValidator');
  text=text.replace(oldValidator,`  async runValidator(request){const scope=this.executionScope(request.task,request.policyContext,{workUnitId:null});const cited=this.validatorAttachmentInputs(request.task,request.candidates).map(item=>(request.task.attachments||[]).find(attachment=>attachment.path===item.path)).filter(Boolean);const stagedTask=this.stageSelectedAttachments(request.task,scope.scratch,cited);const text=await this.client.runTurn({...scope,prompt:this.validatorPrompt({...request,task:stagedTask}),inputItems:this.attachmentInputs(stagedTask),outputSchema:validatorSchema,model:request.modelPolicy?.model||null,reasoningEffort:request.modelPolicy?.reasoningEffort||null,onProgress:request.onProgress||null,onExecutionStarted:request.onExecutionStarted||null,signal:request.signal||null,diagnosticContext:{taskId:request.task?.id||null,workUnitId:null,role:'validator',projectAccess:'none',networkAccess:false,routeReason:request.modelPolicy?.routeReason||null,configuredDefaultModel:request.modelPolicy?.configuredDefaultModel||null}});return safeParse(text);}
`);
  return text;
});

// Direct App Server client tests now model the current permission-profile protocol.
edit('tests/codex-app-server-client.test.js', text=>{
  text=replaceOnce(text,"import { CodexAppServerClient } from '../src/extensions/executors/codex/app-server-client.js';","import { CodexAppServerClient } from '../src/extensions/executors/codex/app-server-client.js';\n\nfunction turnGrant(dir){return{permissionProfile:'taskboard_runtime',runtimeWorkspaceRoots:[dir]};}",'turnGrant helper');
  text=text.replace(/result:\{ thread:\{ id:([^,]+), ephemeral:true \} \}/g,"result:{ thread:{ id:$1, ephemeral:true }, activePermissionProfile:{id:msg.params.permissions}, runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[] }");
  text=text.replace(/result:\{thread:\{id:([^,]+),ephemeral:true\}\}/g,"result:{thread:{id:$1,ephemeral:true},activePermissionProfile:{id:msg.params.permissions},runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[]}");
  text=text.replace(/networkAccess:\s*false,/g,match=>`${match} ...turnGrant(dir),`);

  const legacy=/function createSandboxStrictFakeCodex\(dir\) \{[\s\S]*?\nfunction createInterruptFakeCodex/;
  if(!legacy.test(text))throw new Error('missing patch anchor: legacy sandbox test block');
  text=text.replace(legacy,`function createPermissionStrictFakeCodex(dir) {
  const file = join(dir, 'codex-permission-strict.mjs');
  writeFileSync(file, \`#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-fake current'); process.exit(0); }
const rl = readline.createInterface({ input: process.stdin });
const send = value => process.stdout.write(JSON.stringify(value) + '\\\\n');
rl.on('line', line => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') {
    if (msg.params?.capabilities?.experimentalApi !== true) return send({id:msg.id,error:{code:-32602,message:'experimentalApi required'}});
    return send({ id:msg.id, result:{} });
  }
  if (msg.method === 'thread/start') {
    if (msg.params?.permissions !== 'taskboard_runtime') return send({id:msg.id,error:{code:-32602,message:'permission profile missing'}});
    if (!Array.isArray(msg.params?.runtimeWorkspaceRoots) || msg.params.runtimeWorkspaceRoots.length !== 1) return send({id:msg.id,error:{code:-32602,message:'runtime roots missing'}});
    if (msg.params?.config?.permissions?.taskboard_runtime == null) return send({id:msg.id,error:{code:-32602,message:'profile config missing'}});
    return send({ id:msg.id, result:{ thread:{ id:'thr_strict', ephemeral:true }, activePermissionProfile:{id:msg.params.permissions}, runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots } });
  }
  if (msg.method === 'turn/start') {
    if ('sandboxPolicy' in msg.params) return send({id:msg.id,error:{code:-32602,message:'legacy sandbox must not be combined with permissions'}});
    if (msg.params?.effort !== 'high') return send({ id:msg.id, error:{ code:-32602, message:'missing expected effort override' } });
    send({ id:msg.id, result:{ turn:{ id:'turn_strict', status:'inProgress', items:[] } } });
    setTimeout(() => {
      send({ method:'item/completed', params:{ threadId:'thr_strict', turnId:'turn_strict', item:{ type:'agentMessage', text:'{\\"kind\\":\\"complete\\"}' } } });
      send({ method:'turn/completed', params:{ threadId:'thr_strict', turn:{ id:'turn_strict', status:'completed', items:[], error:null } } });
    }, 5);
  }
});
\`);
  chmodSync(file, 0o755);
  return file;
}

test('Codex app-server applies the TaskBoard permission profile and exact runtime roots without legacy sandboxPolicy', async () => {
  if (process.platform === 'win32') return;
  const dir = mkdtempSync(join(tmpdir(), 'taskboard-fake-codex-permissions-'));
  const command = createPermissionStrictFakeCodex(dir);
  const client = new CodexAppServerClient({ command });
  try {
    const text = await client.runTurn({
      cwd:dir, writableRoots:[], prompt:'test', inputItems:[], outputSchema:{type:'object'}, reasoningEffort:'high', networkAccess:false,
      ...turnGrant(dir),
      runtimeConfig:{permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':'read'}},network:{enabled:false}}}},
    });
    assert.match(text, /\\"kind\\":\\"complete\\"/);
  } finally { client.close(); rmSync(dir,{recursive:true,force:true}); }
});

function createPermissionIgnoringFakeCodex(dir) {
  const file=join(dir,'codex-permission-ignore.mjs');
  writeFileSync(file,\`#!/usr/bin/env node
import readline from 'node:readline';
if (process.argv.includes('--version')) { console.log('codex-fake legacy'); process.exit(0); }
const rl=readline.createInterface({input:process.stdin});const send=value=>process.stdout.write(JSON.stringify(value)+'\\\\n');
rl.on('line',line=>{const msg=JSON.parse(line);if(msg.method==='initialize')return send({id:msg.id,result:{}});if(msg.method==='thread/start')return send({id:msg.id,result:{thread:{id:'legacy',ephemeral:true}}});});
\`);chmodSync(file,0o755);return file;
}

test('Codex app-server that cannot confirm the permission profile fails closed',async()=>{
  if(process.platform==='win32')return;
  const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-permission-ignore-'));const client=new CodexAppServerClient({command:createPermissionIgnoringFakeCodex(dir)});
  try{await assert.rejects(client.runTurn({cwd:dir,writableRoots:[],prompt:'test',inputItems:[],outputSchema:{type:'object'},networkAccess:false,...turnGrant(dir)}),/CODEX_PERMISSION_PROFILE_NOT_APPLIED/);}finally{client.close();rmSync(dir,{recursive:true,force:true});}
});

function createInterruptFakeCodex`);
  return text;
});

// Full-flow fake speaks the new permission protocol and performs one bounded source Work Unit before Human Gateway.
edit('tests/codex-full-flow.test.js', text=>{
  text=replaceOnce(text,
    "  if (msg.method === 'thread/start') return send({ id:msg.id, result:{ thread:{ id:'thr_' + (turnNo + 1), ephemeral:true } } });",
    "  if (msg.method === 'thread/start') return send({ id:msg.id, result:{ thread:{ id:'thr_' + (turnNo + 1), ephemeral:true }, activePermissionProfile:{id:msg.params.permissions}, runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[] } });",
    'full-flow thread permissions');
  text=text.replace("    if (!['workspace-write','read-only'].includes(msg.params?.sandboxPolicy?.type)) return send({ id:msg.id, error:{ code:-32600, message:'Invalid sandbox policy' } });\n","");
  const roleAnchor="    const prompt = msg.params.input?.[0]?.text || '';\n    if (prompt.includes('Semantic proof obligation:')) {";
  const roleReplacement=`    const prompt = msg.params.input?.[0]?.text || '';
    if (prompt.includes('Work Unit protocol:')) {
      const payload={delegationId:'project-scan',result:'项目范围已检查',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null};
      return setTimeout(()=>{send({method:'item/completed',params:{threadId,turnId,item:{id:'agent_'+turnNo,type:'agentMessage',text:JSON.stringify(payload)}}});send({method:'turn/completed',params:{threadId,turn:{id:turnId,status:'completed',items:[],error:null}}});},5);
    }
    if (prompt.includes('Semantic proof obligation:')) {`;
  text=replaceOnce(text,roleAnchor,roleReplacement,'full-flow subagent role');
  const payloadAnchor="    const answered = prompt.includes('基础办公');\n    const payload = answered\n      ?";
  const payloadReplacement=`    const answered = prompt.includes('基础办公');
    const hasProjectResult=prompt.includes('project-scan');
    const payload = !hasProjectResult
      ? {kind:'delegate',summary:'先核对项目范围',stageResult:null,finalResult:null,resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gapResolutions:[],gateway:null,delegations:[{id:'project-scan',title:'核对项目范围',goal:'核对项目中与 OA 范围相关的现有事实',expectedOutput:'返回项目范围核对结果',stopCondition:'完成有限核对后停止',projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']}]}
      : answered
      ?`;
  text=replaceOnce(text,payloadAnchor,payloadReplacement,'full-flow initial delegation');
  return text;
});

// Unit fixtures must pass the same compiled execution-grant contract as production callers.
edit('tests/codex-executor.test.js', text=>{
  const helper=`
const rootPolicy=(taskMode='analysis')=>({taskMode,prompt:'POLICY',executionGrant:{role:'root',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'none'}});
const subPolicy=({taskMode='analysis',projectAccess='none',networkAccess=false,inputRefs=[]}={})=>({taskMode,prompt:'POLICY',executionGrant:{role:'subagent',projectAccess,networkAccess,inputRefs,sourceAccess:inputRefs.length?'selected':'none'}});
`;
  text=replaceOnce(text,"class CaptureClient {",helper+"\nclass CaptureClient {",'CodexExecutor policy helpers');
  text=replaceOnce(text,"      subagentResults:[], humanGatewayHistory:[], modelPolicy:{ model:null },\n    });","      subagentResults:[], humanGatewayHistory:[], modelPolicy:{ model:null }, policyContext:rootPolicy('analysis'),\n    });",'attachment Root policy');

  const scopeBlock=/    const task=\{id:'T-analysis',projectScopes:\[\{path:project\}\]\};[\s\S]*?    assert\.equal\(executor\.cleanupTaskWorkspace\(task\.id\),true\);/;
  if(!scopeBlock.test(text))throw new Error('missing patch anchor: CodexExecutor scope test');
  text=text.replace(scopeBlock,`    const task={id:'T-analysis',projectScopes:[{path:project}]};
    const analysisRoot=executor.executionScope(task,rootPolicy('analysis'));
    assert.notEqual(analysisRoot.cwd,project);
    assert.deepEqual(analysisRoot.runtimeWorkspaceRoots,[analysisRoot.cwd]);
    assert.equal(analysisRoot.runtimeWorkspaceRoots.includes(project),false);
    assert.equal(analysisRoot.projectAccess,'none');

    const readSubagent=executor.executionScope(task,subPolicy({taskMode:'analysis',projectAccess:'read',inputRefs:['project:0']}),{workUnitId:'inspect'});
    assert.notEqual(readSubagent.cwd,project);
    assert.equal(readSubagent.runtimeWorkspaceRoots.includes(project),true,'selected Project is readable through the explicit Runtime roots');
    assert.deepEqual(readSubagent.writableRoots,[],'read Work Unit does not gain Project write authority');

    const executionRoot=executor.executionScope(task,rootPolicy('execution'));
    assert.notEqual(executionRoot.cwd,project,'Root execution control turn must not become an implicit project writer');
    assert.equal(executionRoot.runtimeWorkspaceRoots.includes(project),false);

    const writeWorker=executor.executionScope(task,subPolicy({taskMode:'execution',projectAccess:'write',inputRefs:['project:0']}),{workUnitId:'change'});
    assert.equal(writeWorker.runtimeWorkspaceRoots.includes(project),true);
    assert.equal(writeWorker.writableRoots.includes(project),true);

    assert.equal(executor.cleanupTaskWorkspace(task.id),true);`);
  text=text.replace("policyContext:{taskMode:'analysis',prompt:'POLICY'},","policyContext:rootPolicy('analysis'),");
  text=text.replace("policyContext:{taskMode:'analysis'},modelPolicy:{}","policyContext:subPolicy({taskMode:'analysis',projectAccess:'none',networkAccess:false,inputRefs:[]}),modelPolicy:{}");
  text=text.replace("policyContext:{taskMode:'analysis'},modelPolicy:{}","policyContext:subPolicy({taskMode:'analysis',projectAccess:'none',networkAccess:true,inputRefs:[]}),modelPolicy:{}");
  text=text.replace("policyContext:{taskMode:'analysis'},modelPolicy:{}","policyContext:subPolicy({taskMode:'analysis',projectAccess:'none',networkAccess:true,inputRefs:[]}),modelPolicy:{}");
  return text;
});

edit('tests/context-input-scope.test.js', text=>replaceOnce(
  text,
  "    const scope=executor.executionScope(selected,{taskMode:'execution'},{role:'subagent',projectAccess:'write',workUnitId:'w'});",
  "    const scope=executor.executionScope(selected,{taskMode:'execution',executionGrant:{role:'subagent',projectAccess:'write',networkAccess:false,inputRefs:['project:1','attachment:A-2','reference:T-old-2'],sourceAccess:'selected'}},{workUnitId:'w'});",
  'context scope execution grant',
));

edit('tests/validator-semantic-proof.test.js', text=>{
  text=text.replace(/policyContext:\{taskMode:'analysis',prompt:'CAPABILITY CONTRACT — VALIDATOR'\}/g,"policyContext:{taskMode:'analysis',prompt:'CAPABILITY CONTRACT — VALIDATOR',executionGrant:{role:'validator',projectAccess:'none',networkAccess:false,inputRefs:[],sourceAccess:'proof-only'}}");
  return text;
});

edit('tests/runtime-regressions.test.js', text=>replaceOnce(
  text,
  "projectScopes:[],attachments:[{name:'requirements.txt',path:attachment}],references:[{source_task_id:'REF-1',title:'已确认需求',final_result:'附件规定 OA→ERP 为现有逻辑'}]",
  "projectScopes:[],attachments:[],references:[{source_task_id:'REF-1',title:'已确认需求',final_result:'附件规定 OA→ERP 为现有逻辑'}]",
  'History test uses Root-owned Reference only',
));

edit('tests/scheduler.test.js', text=>{
  const old=/test\('certified Root convergence stops obsolete read-only sibling work instead of recreating a whole-stage tail barrier',[\s\S]*?\n\}\);/;
  if(!old.test(text))throw new Error('missing patch anchor: old sibling cancellation test');
  text=text.replace(old,`test('Root may synthesize an early Work Unit result while final completion still waits for every issued obligation',async()=>{
  let slowStarted=false,releaseSlow;const deliveries=[];
  const executor={
    async runRoot({subagentResults,onExecutionStarted}){
      onExecutionStarted?.();deliveries.push(subagentResults.map(item=>item.delegationId));
      if(!subagentResults.length)return{kind:'delegate',summary:'split',stageResult:null,finalResult:null,confirmed:[],recommendations:[],openQuestions:[],gateway:null,delegations:[
        {id:'fast',title:'关键证据',goal:'取得关键证据',expectedOutput:'返回关键证据',stopCondition:'证据取得后停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},
        {id:'slow',title:'补充证据',goal:'完成已签发的补充核对',expectedOutput:'返回补充证据',stopCondition:'补充结束后停止',projectAccess:'none',networkAccess:false,skillId:null,dependsOn:[],inputRefs:[]},
      ]};
      return complete('当前结果已可综合');
    },
    async runSubagent({delegation,onExecutionStarted}){
      onExecutionStarted?.();
      if(delegation.id==='fast')return{delegationId:'fast',result:'足够',evidence:[],claims:[],gaps:[],recommendations:[],discoveries:[],blocker:null,uncertainty:null};
      slowStarted=true;return new Promise(resolve=>{releaseSlow=()=>resolve({delegationId:'slow',result:'补充完成',evidence:[],claims:[],gaps:[],recommendations:[],discoveries:[],blocker:null,uncertainty:null});});
    },
  };
  const x=rig(executor,{maxConcurrentSubagents:2});
  try{
    const task=x.scheduler.createTask({title:'局部收敛',instruction:'执行到证据足够即可'});const ticking=x.scheduler.tick();
    for(let i=0;i<100&&!slowStarted;i++)await new Promise(r=>setTimeout(r,2));
    assert.equal(slowStarted,true,'independent sibling starts in parallel');
    for(let i=0;i<100&&!deliveries.some(ids=>ids.includes('fast'));i++)await new Promise(r=>setTimeout(r,2));
    assert.equal(deliveries.some(ids=>ids.includes('fast')),true,'Root receives the early result without waiting for the whole stage');
    assert.equal(x.service.getTask(task.id).status,TaskStatus.RUNNING,'complete candidate cannot silently cancel an issued sibling');
    releaseSlow();await ticking;
    assert.equal(x.service.getTask(task.id).status,TaskStatus.COMPLETED);
  }finally{x.close();}
});`);
  return text;
});

edit('tests/runtime-authority-boundary.test.js', text=>{
  text=replaceOnce(text,"    assert.equal(call.permissionProfile,':read-only');","    assert.equal(call.permissionProfile,'taskboard_runtime');\n    assert.equal(call.runtimeConfig.permissions.taskboard_runtime.filesystem[':workspace_roots']['.'],'read');\n    assert.equal(call.runtimeConfig.permissions.taskboard_runtime.network.enabled,false);\n    assert.deepEqual(call.environments,[]);",'permission profile expectation');
  text=replaceOnce(text,"  const runtime=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:analysisValidatorRuntime()});","  const runtime=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,validatorRuntime:analysisValidatorRuntime(),governanceCompiler:new GovernanceCompiler({rootDir})});",'source completion compiler fixture');
  text=text.replace("/SOURCE_ANALYSIS_REQUIRES_DELEGATED_EVIDENCE/,","/ROOT_INVALID_COMPLETION_PLAN: SOURCE_ANALYSIS_REQUIRES_DELEGATED_EVIDENCE/,");
  text=text.replace("    assert.equal(rootTurns,1);","    assert.equal(rootTurns,2,'one bounded planning repair is allowed before fail-closed rejection');");
  return text;
});

console.log('goal authority integration/test migration patch applied');
