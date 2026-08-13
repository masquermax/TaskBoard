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

edit('src/governance/governance-compiler.js', text=>{
  const old=`  const explicitExecution = /(?:请|帮我|直接|现在|开始|需要|把|给我)?\\s*(?:开发|修复(?:这个|该|当前|问题|bug|代码|功能|项目)|修改(?:代码|文件|功能|项目)|新增功能|生成(?:新版|代码|版本|文件|项目)|部署(?:到|这个|该)?|安装(?:依赖|组件|软件|包)?|删除(?:代码|文件|资源|任务|项目)?|重构(?:代码|项目)?|提交(?:代码|变更)?|打包(?:发布|项目)?|发布(?:版本|项目)?|升级(?:版本|依赖|项目)?|改造代码|写代码)|(?:请|帮我|直接|现在|开始|需要|把|给我|要求|完成)\\s*(?:这个|该|当前|以下|上述)?\\s*实现(?:一下|功能|需求|逻辑|代码|方案|改造)?|实现(?:这个|该|以下|上述)?(?:功能|需求|逻辑|代码|方案|改造)|(?:implement|fix|modify|deploy|install|refactor|release|build)\\b/i.test(mutationText);`;
  const replacement=`  const explicitExecution = /(?:^|[\\n。；;])\\s*(?:(?:请|帮我|直接|现在|开始|需要|把|给我|要求|完成)\\s*)?(?:开发|实现|修复|修改|新增|生成|部署|安装|删除|重构|提交|打包|发布|升级|改造|写代码)\\b?/i.test(mutationText)
    || /(?:请|帮我|直接|现在|开始|需要|把|给我|要求|完成)[^，。；;\\n]{0,40}(?:开发|实现|修复|修改|新增|生成|部署|安装|删除|重构|提交|打包|发布|升级|改造|写代码)/i.test(mutationText)
    || /(?:^|[\\n.;])\\s*(?:please\\s+)?(?:implement|fix|modify|deploy|install|refactor|release|build)\\b/i.test(mutationText);`;
  return replaceOnce(text,old,replacement,'taskMode imperative execution detection');
});

edit('src/extensions/executors/codex/codex-executor.js', text=>{
  text=replaceOnce(text,
    "      permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':fileAccess}},network:{enabled:networkAccess}}},",
    "      permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':fileAccess}},network:{enabled:false}}},",
    'shell/process network is never granted');
  return text;
});

edit('src/extensions/executors/codex/app-server-client.js', text=>{
  const threadParams=`      permissions:executionGrant.profile,
      runtimeWorkspaceRoots:executionGrant.roots,
      ...(Array.isArray(environments)?{environments}:{}),`;
  const threadParamsNew=`      permissions:executionGrant.profile,
      runtimeWorkspaceRoots:executionGrant.roots,
      selectedCapabilityRoots:[],
      ...(Array.isArray(environments)?{environments}:{}),`;
  text=replaceOnce(text,threadParams,threadParamsNew,'disable environment capability roots');

  const afterRoots=`    if(!this.sameRuntimeRoots(executionGrant.roots,thread?.runtimeWorkspaceRoots||[])){const error=new Error('CODEX_RUNTIME_ROOTS_NOT_APPLIED: app-server did not confirm the exact Runtime workspace roots.');error.nonRetryable=true;throw error;}
    const threadId = thread.thread.id;`;
  const afterRootsNew=`    if(!this.sameRuntimeRoots(executionGrant.roots,thread?.runtimeWorkspaceRoots||[])){const error=new Error('CODEX_RUNTIME_ROOTS_NOT_APPLIED: app-server did not confirm the exact Runtime workspace roots.');error.nonRetryable=true;throw error;}
    const instructionSources=Array.isArray(thread?.instructionSources)?thread.instructionSources:[];
    if(instructionSources.length){const error=new Error('CODEX_AMBIENT_INSTRUCTIONS_PRESENT: TaskBoard role context cannot inherit external instruction sources.');error.nonRetryable=true;error.contextBoundary=true;throw error;}
    const threadId = thread.thread.id;
    let mcpStatus;
    try{mcpStatus=await this.request('mcpServerStatus/list',{threadId,cursor:null,limit:1},5_000);}catch(error){const isolation=new Error(\`CODEX_AMBIENT_CAPABILITY_INSPECTION_UNAVAILABLE: \${error?.message||error}\`);isolation.nonRetryable=true;isolation.contextBoundary=true;throw isolation;}
    if(Array.isArray(mcpStatus?.data)&&mcpStatus.data.length){const error=new Error('CODEX_AMBIENT_MCP_PRESENT: current TaskBoard roles do not own ambient MCP/App/Plugin tools.');error.nonRetryable=true;error.authorityViolation=true;throw error;}`;
  text=replaceOnce(text,afterRoots,afterRootsNew,'ambient instructions/MCP fail-closed preflight');

  text=replaceOnce(text,
    "    } catch(error) {\n      this.recordDiagnostic('turn-failed',{",
    "    } catch(error) {\n      if(!completed&&!interruptRequested)interrupt();\n      this.recordDiagnostic('turn-failed',{",
    'interrupt turn on any local post-start failure');
  return text;
});

edit('src/core/json-repository.js', text=>{
  text=replaceOnce(text,
    "        if (!Array.isArray(task.work_receipts)) task.work_receipts = [];",
    "        if (!Array.isArray(task.work_receipts)) task.work_receipts = [];\n        for (const receipt of task.work_receipts) if (!receipt.status) receipt.status = receipt.result ? 'completed' : 'running';",
    'work receipt status migration');

  const commitStart="  commitWorkReceipt(taskId,receipt){\n    const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');";
  const methods=`  beginWorkReceipt(taskId,receipt){
    const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');
    const value=clone(receipt||{});const id=String(value.id||value.workUnit?.id||'').trim(),signature=String(value.signature||'').trim();
    if(!id||!signature||!value.workUnit)throw new Error('WORK_RECEIPT_INVALID');
    this.store.transaction(()=>{
      if(!Array.isArray(t.work_receipts))t.work_receipts=[];
      const existing=t.work_receipts.find(item=>String(item?.signature||'')===signature||String(item?.id||'')===id);
      if(existing)throw new Error('WORK_RECEIPT_ALREADY_EXISTS');
      t.work_receipts.push({...value,id,signature,status:'running',result:null,started_at:value.started_at||this.now(),completed_at:null,consumed_at:null});
    });
    return this.getTask(taskId);
  }
  commitWorkReceipt(taskId,receipt){
    const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');`;
  text=replaceOnce(text,commitStart,methods,'begin side-effecting work receipt');

  const oldBody=`      const byId=t.work_receipts.find(item=>String(item?.id||'')===id);
      if(byId&&String(byId.signature||'')!==signature)throw new Error('WORK_RECEIPT_ID_CONFLICT');
      const existing=t.work_receipts.find(item=>String(item?.signature||'')===signature);
      if(existing)return;
      t.work_receipts.push({...value,id,signature,completed_at:value.completed_at||this.now(),consumed_at:null});`;
  const newBody=`      const byId=t.work_receipts.find(item=>String(item?.id||'')===id);
      if(byId&&String(byId.signature||'')!==signature)throw new Error('WORK_RECEIPT_ID_CONFLICT');
      const existing=t.work_receipts.find(item=>String(item?.signature||'')===signature);
      if(existing){
        if(String(existing.id)!==id) return;
        existing.status='completed';existing.result=clone(value.result);existing.completed_at=value.completed_at||this.now();
        return;
      }
      t.work_receipts.push({...value,id,signature,status:'completed',completed_at:value.completed_at||this.now(),consumed_at:null});`;
  return replaceOnce(text,oldBody,newBody,'complete running receipt instead of duplicating');
});

edit('src/core/root-runtime.js', text=>{
  text=replaceOnce(text,
    "    canRetry: unit.status === WorkUnitStatus.SUSPENDED,",
    "    canRetry: unit.status === WorkUnitStatus.SUSPENDED && unit.retryForbidden !== true,",
    'retry surface honors side-effect uncertainty');
  text=replaceOnce(text,
    "    if (!unit || unit.status !== WorkUnitStatus.SUSPENDED) return false;",
    "    if (!unit || unit.status !== WorkUnitStatus.SUSPENDED || unit.retryForbidden === true) return false;",
    'manual retry rejects uncertain side effect');

  text=replaceOnce(text,
    "    const durableWorkReceipts=(Array.isArray(task.workReceipts)?task.workReceipts:[]).filter(receipt=>receipt?.signature&&receipt?.workUnit&&receipt?.result);\n    const pendingWorkResults=durableWorkReceipts.filter(receipt=>!receipt.consumed_at).map(receipt=>({...clone(receipt.result),workUnit:clone(receipt.workUnit),persistedReceipt:true}));",
    "    const durableWorkReceipts=(Array.isArray(task.workReceipts)?task.workReceipts:[]).filter(receipt=>receipt?.signature&&receipt?.workUnit);\n    const pendingWorkResults=durableWorkReceipts.filter(receipt=>receipt.status==='completed'&&receipt.result&&!receipt.consumed_at).map(receipt=>({...clone(receipt.result),workUnit:clone(receipt.workUnit),persistedReceipt:true}));\n    const uncertainWriteReceipts=durableWorkReceipts.filter(receipt=>receipt.status==='running'&&receipt.workUnit?.projectAccess==='write');",
    'restore running write receipts');
  text=replaceOnce(text,
    "      completedWorkUnits: durableWorkReceipts.map(receipt=>({ id:receipt.id, stageId:null, title:receipt.workUnit.title||receipt.id, projectAccess:receipt.workUnit.projectAccess||'none', networkAccess:receipt.workUnit.networkAccess===true, status:WorkUnitStatus.COMPLETED, detail:receipt.result?.result||'工作已完成。', updatedAt:receipt.completed_at||nowIso(), failureCount:0, nextRetryAt:null, canRetry:false, owner:'subagent' })),",
    "      completedWorkUnits: durableWorkReceipts.filter(receipt=>receipt.status==='completed'&&receipt.result).map(receipt=>({ id:receipt.id, stageId:null, title:receipt.workUnit.title||receipt.id, projectAccess:receipt.workUnit.projectAccess||'none', networkAccess:receipt.workUnit.networkAccess===true, status:WorkUnitStatus.COMPLETED, detail:receipt.result?.result||'工作已完成。', updatedAt:receipt.completed_at||nowIso(), failureCount:0, nextRetryAt:null, canRetry:false, owner:'subagent' })),\n      uncertainWriteReceipts,",
    'restore only completed visibility');

  const executeCallbacks="  async execute(task, { humanGatewayHistory = [], onProgress = null, onStageCompleted = null, onStageResult = null, onProgressCommit = null, onCertifiedTurn = null, onWorkReceipt = null, onWorkReceiptsConsumed = null, onExecutionStarted = null } = {}) {";
  const executeCallbacksNew="  async execute(task, { humanGatewayHistory = [], onProgress = null, onStageCompleted = null, onStageResult = null, onProgressCommit = null, onCertifiedTurn = null, onWorkStarted = null, onWorkReceipt = null, onWorkReceiptsConsumed = null, onExecutionStarted = null } = {}) {";
  text=replaceOnce(text,executeCallbacks,executeCallbacksNew,'work-start persistence callback API');
  text=replaceOnce(text,
    "    const callbacks = { onProgress, onStageCompleted, onStageResult, onProgressCommit, onCertifiedTurn, onWorkReceipt, onWorkReceiptsConsumed, onExecutionStarted };",
    "    const callbacks = { onProgress, onStageCompleted, onStageResult, onProgressCommit, onCertifiedTurn, onWorkStarted, onWorkReceipt, onWorkReceiptsConsumed, onExecutionStarted };\n    if(session.uncertainWriteReceipts?.length){session.actor={title:'写入恢复待确认',status:WorkUnitStatus.SUSPENDED,detail:'检测到上次进程留下的未闭合写入 Work Receipt。为避免重复副作用，Runtime 不会自动重跑该写入。',updatedAt:nowIso(),owner:'subagent'};this.emit(session,callbacks);return{kind:'suspended',reason:'存在未闭合写入 Work Receipt，禁止自动重试',snapshot:this.makeSnapshot(session),quiescent:true};}",
    'suspend on recovered uncertain write');

  const onStarted=`      onExecutionStarted: () => {
        unit.status = WorkUnitStatus.RUNNING;`;
  const onStartedNew=`      onExecutionStarted: () => {
        if((unit.projectAccess||'none')==='write'){
          const workUnit={ id:unit.id, title:unit.title, goal:unit.goal, expectedOutput:unit.expectedOutput, stopCondition:unit.stopCondition, projectAccess:'write', networkAccess:unit.networkAccess===true, skillId:unit.skillId, dependsOn:[...(unit.dependsOn||[])], inputRefs:[...(unit.inputRefs||[])] };
          const intent={id:unit.id,signature:workSemanticSignature(workUnit),workUnit,started_at:nowIso()};
          try{callbacks.onWorkStarted?.(intent);unit.sideEffectStarted=true;}catch(error){error.nonRetryable=true;error.workStartPersistence=true;unit.sideEffectStarted=true;throw error;}
        }
        unit.status = WorkUnitStatus.RUNNING;`;
  text=replaceOnce(text,onStarted,onStartedNew,'persist write intent at actual execution start');

  const catchAnchor=`    }).catch(error => {
      if (session.cancelRequested && isInterrupted(error)) return;
      if (isCapacityUnavailable(error)) {`;
  const catchNew=`    }).catch(error => {
      if (session.cancelRequested && isInterrupted(error)) return;
      if ((unit.projectAccess||'none')==='write' && unit.sideEffectStarted) {
        unit.failureCount += 1;unit.owner='subagent';unit.status=WorkUnitStatus.SUSPENDED;unit.nextRetryAt=null;unit.retryForbidden=true;unit.detail='写入执行已经开始，但本次没有形成可安全重放的完成边界。为避免重复副作用，已禁止自动和手工重试；请先核对 Project 当前状态。';unit.updatedAt=nowIso();return;
      }
      if (isCapacityUnavailable(error)) {`;
  return replaceOnce(text,catchAnchor,catchNew,'write work never retries after start');
});

edit('src/core/scheduler.js', text=>replaceOnce(
  text,
  "        onWorkReceipt:receipt=>{if(this.shuttingDown){const error=new Error('WORK_RECEIPT_PERSISTENCE_UNAVAILABLE_DURING_SHUTDOWN');error.nonRetryable=true;throw error;}this.repository.commitWorkReceipt(taskId,receipt);},",
  "        onWorkStarted:intent=>{if(this.shuttingDown){const error=new Error('WORK_START_PERSISTENCE_UNAVAILABLE_DURING_SHUTDOWN');error.nonRetryable=true;throw error;}this.repository.beginWorkReceipt(taskId,intent);},\n        onWorkReceipt:receipt=>{if(this.shuttingDown){const error=new Error('WORK_RECEIPT_PERSISTENCE_UNAVAILABLE_DURING_SHUTDOWN');error.nonRetryable=true;throw error;}this.repository.commitWorkReceipt(taskId,receipt);},",
  'Scheduler persists write intent before side effects'));

// Tests: task-mode nouns remain analysis; shell network stays closed; write starts are durable and non-retryable.
edit('tests/runtime-authority-boundary.test.js', text=>{
  text=replaceOnce(text,
    "  assert.equal(inferTaskMode({title:'架构审查',instruction:'分析当前实现并定位根因'}),'analysis');",
    "  assert.equal(inferTaskMode({title:'架构审查',instruction:'分析当前实现并定位根因'}),'analysis');\n  assert.equal(inferTaskMode({title:'需求分析',instruction:'分析功能实现逻辑并评估现状'}),'analysis');\n  assert.equal(inferTaskMode({title:'代码审查',instruction:'核对当前修复方案和实现代码是否合理'}),'analysis');",
    'noun-like implementation regressions');

  const insert=`
test('write Work Unit start becomes a durable non-retryable boundary once execution begins',async()=>{
  let rootTurns=0,workRuns=0;const started=[];
  const executor={
    async runRoot(){rootTurns+=1;return rootTurns===1?{kind:'delegate',summary:'write',stageResult:null,finalResult:null,resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[{id:'W',title:'write',goal:'write',expectedOutput:'done',stopCondition:'done',projectAccess:'write',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']}]}:{kind:'complete',summary:'done',stageResult:null,finalResult:'done',resultMode:'execution',evidence:[],claims:[],gaps:[],recommendations:[],steps:[],gateway:null,gapResolutions:[],delegations:[]};},
    async runSubagent({onExecutionStarted}){workRuns+=1;onExecutionStarted?.();const error=new Error('transport lost after write started');throw error;},
  };
  const router=new ModelRouter();const subagent=new SubagentRuntime({executor,modelRouter:router});const runtime=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent,governanceCompiler:new GovernanceCompiler({rootDir})});
  const task={id:'T-WRITE',title:'修复代码',instruction:'请修改代码',projectScopes:[{path:'/tmp/project'}],attachments:[],references:[],ready_reason:'NEW'};
  const outcome=await runtime.execute(task,{onWorkStarted:intent=>started.push(intent)});
  assert.equal(outcome.kind,'suspended');assert.equal(workRuns,1);assert.equal(started.length,1);assert.equal(runtime.retryWorkUnit(task.id,'W'),false,'uncertain write must not be replayed');
});

test('recovered running write receipt suspends before Root or Subagent can re-execute it',async()=>{
  let rootRuns=0;const executor={async runRoot(){rootRuns+=1;throw new Error('must not run');}};const router=new ModelRouter();const subagent=new SubagentRuntime({executor,modelRouter:router});const runtime=new RootRuntime({executor,modelRouter:router,subagentRuntime:subagent});
  const task={id:'T-RECOVER-WRITE',title:'write',instruction:'write',projectScopes:[],attachments:[],references:[],workReceipts:[{id:'W',signature:'sig',status:'running',workUnit:{id:'W',title:'write',projectAccess:'write'},result:null,started_at:'2026-08-13T00:00:00Z'}]};
  const outcome=await runtime.execute(task);assert.equal(outcome.kind,'suspended');assert.equal(rootRuns,0);
});
`;
  const marker="test('Root completion cannot silently cancel already-issued read-only Work Units',async()=>{";
  return replaceOnce(text,marker,insert+'\n'+marker,'write recovery regressions');
});

edit('tests/codex-executor.test.js', text=>{
  const marker="test('Codex executor grants Project access only to an explicit Subagent Work Unit',()=>{";
  const insert=`test('Subagent network grant enables only Codex web retrieval while shell/process network stays closed',()=>{
  const dir=mkdtempSync(join(tmpdir(),'taskboard-codex-web-only-'));try{const client=new CaptureClient();const executor=new CodexExecutor({runtimeRoot:join(dir,'runtime'),client,networkAccess:true});const task={id:'T-web',projectScopes:[]};const scope=executor.executionScope(task,subPolicy({taskMode:'analysis',projectAccess:'none',networkAccess:true,inputRefs:[]}));assert.equal(scope.networkAccess,true);assert.equal(scope.runtimeConfig.web_search,'live');assert.equal(scope.runtimeConfig.permissions.taskboard_runtime.network.enabled,false);}finally{rmSync(dir,{recursive:true,force:true});}
});

`;
  return replaceOnce(text,marker,insert+marker,'web-only network capability test');
});

edit('tests/codex-app-server-client.test.js', text=>{
  // Every fake app-server used by this file must answer the preflight MCP status call.
  text=text.replace(/if \(msg\.method === 'thread\/start'\)/g,"if (msg.method === 'mcpServerStatus/list') return send({id:msg.id,result:{data:[],nextCursor:null}});\n  if (msg.method === 'thread/start')");
  text=text.replace(/if\(msg\.method==='thread\/start'\)/g,"if(msg.method==='mcpServerStatus/list')return send({id:msg.id,result:{data:[],nextCursor:null}});if(msg.method==='thread/start')");

  const append=`

test('Codex thread fails closed before a model turn when ambient MCP tools remain configured',async()=>{
  if(process.platform==='win32')return;
  const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-mcp-present-'));const file=join(dir,'codex-mcp-present.mjs');
  writeFileSync(file,\`#!/usr/bin/env node
import readline from 'node:readline';if(process.argv.includes('--version')){console.log('codex-fake current');process.exit(0);}const rl=readline.createInterface({input:process.stdin});const send=v=>process.stdout.write(JSON.stringify(v)+'\\\\n');rl.on('line',line=>{const msg=JSON.parse(line);if(msg.method==='initialize')return send({id:msg.id,result:{}});if(msg.method==='thread/start')return send({id:msg.id,result:{thread:{id:'t',ephemeral:true},activePermissionProfile:{id:msg.params.permissions},runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[],instructionSources:[]}});if(msg.method==='mcpServerStatus/list')return send({id:msg.id,result:{data:[{name:'ambient',tools:{danger:{}}}],nextCursor:null}});if(msg.method==='turn/start')return send({id:msg.id,error:{code:-32000,message:'turn must not start'}});});\`);chmodSync(file,0o755);const client=new CodexAppServerClient({command:file});try{await assert.rejects(client.runTurn({cwd:dir,prompt:'x',outputSchema:{type:'object'},permissionProfile:'taskboard_runtime',runtimeWorkspaceRoots:[dir],runtimeConfig:{permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':'read'}},network:{enabled:false}}}}}),/CODEX_AMBIENT_MCP_PRESENT/);}finally{client.close();rmSync(dir,{recursive:true,force:true});}
});

test('Codex thread fails closed when external instruction sources leak into role context',async()=>{
  if(process.platform==='win32')return;
  const dir=mkdtempSync(join(tmpdir(),'taskboard-fake-codex-instructions-'));const file=join(dir,'codex-instructions.mjs');
  writeFileSync(file,\`#!/usr/bin/env node
import readline from 'node:readline';if(process.argv.includes('--version')){console.log('codex-fake current');process.exit(0);}const rl=readline.createInterface({input:process.stdin});const send=v=>process.stdout.write(JSON.stringify(v)+'\\\\n');rl.on('line',line=>{const msg=JSON.parse(line);if(msg.method==='initialize')return send({id:msg.id,result:{}});if(msg.method==='thread/start')return send({id:msg.id,result:{thread:{id:'t',ephemeral:true},activePermissionProfile:{id:msg.params.permissions},runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[],instructionSources:['/home/user/AGENTS.md']}});});\`);chmodSync(file,0o755);const client=new CodexAppServerClient({command:file});try{await assert.rejects(client.runTurn({cwd:dir,prompt:'x',outputSchema:{type:'object'},permissionProfile:'taskboard_runtime',runtimeWorkspaceRoots:[dir],runtimeConfig:{permissions:{taskboard_runtime:{filesystem:{':minimal':'read',':workspace_roots':{'.':'read'}},network:{enabled:false}}}}}),/CODEX_AMBIENT_INSTRUCTIONS_PRESENT/);}finally{client.close();rmSync(dir,{recursive:true,force:true});}
});
`;
  return text+append;
});

edit('tests/codex-full-flow.test.js', text=>text.replace("  if (msg.method === 'thread/start') return send({ id:msg.id, result:{ thread:{ id:'thr_' + (turnNo + 1), ephemeral:true }, activePermissionProfile:{id:msg.params.permissions}, runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[] } });","  if (msg.method === 'mcpServerStatus/list') return send({id:msg.id,result:{data:[],nextCursor:null}});\n  if (msg.method === 'thread/start') return send({ id:msg.id, result:{ thread:{ id:'thr_' + (turnNo + 1), ephemeral:true }, activePermissionProfile:{id:msg.params.permissions}, runtimeWorkspaceRoots:msg.params.runtimeWorkspaceRoots||[], instructionSources:[] } });"));

console.log('goal authority side-effect/network/ambient-capability patch applied');
