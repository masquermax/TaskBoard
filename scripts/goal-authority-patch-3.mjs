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

// "分析当前实现" is analysis, not an imperative to implement. Keep mutation
// classification conservative because taskMode is an authority input.
edit('src/governance/governance-compiler.js', text=>{
  const old=`  const explicitExecution = /(?:请|帮我|直接|现在|开始|需要|把|给我)?\\s*(?:开发|实现|修复(?:这个|该|当前|问题|bug|代码|功能|项目)|修改(?:代码|文件|功能|项目)|新增功能|生成(?:新版|代码|版本|文件|项目)|部署(?:到|这个|该)?|安装(?:依赖|组件|软件|包)?|删除(?:代码|文件|资源|任务|项目)?|重构(?:代码|项目)?|提交(?:代码|变更)?|打包(?:发布|项目)?|发布(?:版本|项目)?|升级(?:版本|依赖|项目)?|改造代码|写代码)|(?:implement|fix|modify|deploy|install|refactor|release|build)\\b/i.test(mutationText);`;
  const replacement=`  const explicitExecution = /(?:请|帮我|直接|现在|开始|需要|把|给我)?\\s*(?:开发|修复(?:这个|该|当前|问题|bug|代码|功能|项目)|修改(?:代码|文件|功能|项目)|新增功能|生成(?:新版|代码|版本|文件|项目)|部署(?:到|这个|该)?|安装(?:依赖|组件|软件|包)?|删除(?:代码|文件|资源|任务|项目)?|重构(?:代码|项目)?|提交(?:代码|变更)?|打包(?:发布|项目)?|发布(?:版本|项目)?|升级(?:版本|依赖|项目)?|改造代码|写代码)|(?:请|帮我|直接|现在|开始|需要|把|给我|要求|完成)\\s*(?:这个|该|当前|以下|上述)?\\s*实现(?:一下|功能|需求|逻辑|代码|方案|改造)?|实现(?:这个|该|以下|上述)?(?:功能|需求|逻辑|代码|方案|改造)|(?:implement|fix|modify|deploy|install|refactor|release|build)\\b/i.test(mutationText);`;
  return replaceOnce(text,old,replacement,'authority-safe task mode inference');
});

// A completed Work Unit is a durable execution fact. Persist the bounded result
// before Root consumes it so process/Human-Gateway boundaries cannot re-run a
// completed write or forget a completed read.
edit('src/core/json-repository.js', text=>{
  text=replaceOnce(text,
    "        if (task.analysis_state === undefined) task.analysis_state = null;",
    "        if (task.analysis_state === undefined) task.analysis_state = null;\n        if (!Array.isArray(task.work_receipts)) task.work_receipts = [];",
    'work receipt migration');
  text=replaceOnce(text,
    "execution_state:null,analysis_state:null });",
    "execution_state:null,analysis_state:null,work_receipts:[] });",
    'new task work receipts');
  text=replaceOnce(text,
    "executionState:migrateExecutionState(row.execution_state),analysisState:row.analysis_state||null,",
    "executionState:migrateExecutionState(row.execution_state),analysisState:row.analysis_state||null,workReceipts:Array.isArray(row.work_receipts)?clone(row.work_receipts):[],",
    'hydrate work receipts');

  const oldCommit="  commitCertifiedTurn(taskId,{analysisState,historyCommit=null}){const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');this.store.transaction(()=>{t.analysis_state=analysisState==null?null:clone(analysisState);if(historyCommit?.title&&historyCommit?.detail){this.state.progressHistory.push({id:++this.state.counters.progress,task_id:taskId,title:historyCommit.title,detail:historyCommit.detail,completed_at:historyCommit.completedAt||this.now()});t.last_stage_result=historyCommit.detail||null;}});return this.getTask(taskId);}";
  const newCommit=`  commitWorkReceipt(taskId,receipt){
    const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');
    const value=clone(receipt||{});const id=String(value.id||value.workUnit?.id||'').trim(),signature=String(value.signature||'').trim();
    if(!id||!signature||!value.result||!value.workUnit)throw new Error('WORK_RECEIPT_INVALID');
    this.store.transaction(()=>{
      if(!Array.isArray(t.work_receipts))t.work_receipts=[];
      const byId=t.work_receipts.find(item=>String(item?.id||'')===id);
      if(byId&&String(byId.signature||'')!==signature)throw new Error('WORK_RECEIPT_ID_CONFLICT');
      const existing=t.work_receipts.find(item=>String(item?.signature||'')===signature);
      if(existing)return;
      t.work_receipts.push({...value,id,signature,completed_at:value.completed_at||this.now(),consumed_at:null});
    });
    return this.getTask(taskId);
  }
  commitCertifiedTurn(taskId,{analysisState,historyCommit=null,workReceiptIds=[]}){const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');this.store.transaction(()=>{t.analysis_state=analysisState==null?null:clone(analysisState);const consumed=new Set((Array.isArray(workReceiptIds)?workReceiptIds:[]).map(value=>String(value||'').trim()).filter(Boolean));if(consumed.size){for(const receipt of t.work_receipts||[])if(consumed.has(String(receipt?.id||''))&&!receipt.consumed_at)receipt.consumed_at=this.now();}if(historyCommit?.title&&historyCommit?.detail){this.state.progressHistory.push({id:++this.state.counters.progress,task_id:taskId,title:historyCommit.title,detail:historyCommit.detail,completed_at:historyCommit.completedAt||this.now()});t.last_stage_result=historyCommit.detail||null;}});return this.getTask(taskId);}`;
  text=replaceOnce(text,oldCommit,newCommit,'atomic receipt consumption');
  return text;
});

edit('src/core/task-service.js', text=>{
  const old="    const { analysisState:_internalAnalysisState, ...visible } = task;\n    return visible;";
  const replacement=`    const {
      analysisState:_analysisState, analysis_state:_analysisStateRaw,
      workReceipts:_workReceipts, work_receipts:_workReceiptsRaw,
      execution_state:_executionStateRaw,
      ...visible
    } = task;
    if(Array.isArray(visible.attachments))visible.attachments=visible.attachments.map(({path:_localPath,...attachment})=>attachment);
    return visible;`;
  return replaceOnce(text,old,replacement,'public internal-state projection');
});

edit('src/core/root-runtime.js', text=>{
  const createStart="  createSession(task) {\n    const restoredAnalysisState = normalizeCertifiedState(task.analysisState);";
  const createNew=`  createSession(task) {
    const restoredAnalysisState = normalizeCertifiedState(task.analysisState);
    const durableWorkReceipts=(Array.isArray(task.workReceipts)?task.workReceipts:[]).filter(receipt=>receipt?.signature&&receipt?.workUnit&&receipt?.result);
    const pendingWorkResults=durableWorkReceipts.filter(receipt=>!receipt.consumed_at).map(receipt=>({...clone(receipt.result),workUnit:clone(receipt.workUnit),persistedReceipt:true}));`;
  text=replaceOnce(text,createStart,createNew,'restore durable work receipts');
  text=replaceOnce(text,"      subagentResults: [],","      subagentResults: pendingWorkResults,",'restore pending work results');
  text=replaceOnce(text,"      completedWorkUnits: [],","      completedWorkUnits: durableWorkReceipts.map(receipt=>({ id:receipt.id, stageId:null, title:receipt.workUnit.title||receipt.id, projectAccess:receipt.workUnit.projectAccess||'none', networkAccess:receipt.workUnit.networkAccess===true, status:WorkUnitStatus.COMPLETED, detail:receipt.result?.result||'工作已完成。', updatedAt:receipt.completed_at||nowIso(), failureCount:0, nextRetryAt:null, canRetry:false, owner:'subagent' })),",'restore completed work visibility');
  text=replaceOnce(text,"      issuedWorkSignatures: new Set(),","      issuedWorkSignatures: new Set(durableWorkReceipts.map(receipt=>String(receipt.signature||'')).filter(Boolean)),",'restore semantic duplicate guard');

  const startResult=`      session.subagentResults.push({
        ...result,
        workUnit:{ id:unit.id, title:unit.title, goal:unit.goal, expectedOutput:unit.expectedOutput, stopCondition:unit.stopCondition, projectAccess:unit.projectAccess||'none', networkAccess:unit.networkAccess===true, skillId:unit.skillId },
      });`;
  const resultNew=`      const workUnit={ id:unit.id, title:unit.title, goal:unit.goal, expectedOutput:unit.expectedOutput, stopCondition:unit.stopCondition, projectAccess:unit.projectAccess||'none', networkAccess:unit.networkAccess===true, skillId:unit.skillId, dependsOn:[...(unit.dependsOn||[])], inputRefs:[...(unit.inputRefs||[])] };
      const receipt={id:unit.id,signature:workSemanticSignature(workUnit),workUnit,result:clone(result),completed_at:unit.updatedAt};
      try{callbacks.onWorkReceipt?.(receipt);}catch(error){error.nonRetryable=true;error.workReceiptPersistence=true;throw error;}
      session.subagentResults.push({...result,workUnit});`;
  text=replaceOnce(text,startResult,resultNew,'persist result before Root delivery');

  const callbackSignature="  async execute(task, { humanGatewayHistory = [], onProgress = null, onStageCompleted = null, onStageResult = null, onProgressCommit = null, onCertifiedTurn = null, onExecutionStarted = null } = {}) {";
  const callbackNew="  async execute(task, { humanGatewayHistory = [], onProgress = null, onStageCompleted = null, onStageResult = null, onProgressCommit = null, onCertifiedTurn = null, onWorkReceipt = null, onExecutionStarted = null } = {}) {";
  text=replaceOnce(text,callbackSignature,callbackNew,'work receipt callback API');
  text=replaceOnce(text,"    const callbacks = { onProgress, onStageCompleted, onStageResult, onProgressCommit, onCertifiedTurn, onExecutionStarted };","    const callbacks = { onProgress, onStageCompleted, onStageResult, onProgressCommit, onCertifiedTurn, onWorkReceipt, onExecutionStarted };",'work receipt callback wiring');

  const durableCommit=`    const historyCommit=deriveHistoryFromTurn(prepared.turnNode);
    if(prepared.turnNode){
      const commitPayload={analysisState:prepared.state,turnNode:prepared.turnNode,historyCommit:historyCommit?{...historyCommit,completedAt:prepared.turnNode.committedAt}:null};
      if(callbacks.onCertifiedTurn)callbacks.onCertifiedTurn(commitPayload);`;
  const durableCommitNew=`    const historyCommit=deriveHistoryFromTurn(prepared.turnNode);
    const workReceiptIds=(Array.isArray(rootInputs)?rootInputs:[]).map(item=>String(item?.delegationId||item?.workUnit?.id||'').trim()).filter(Boolean);
    if(prepared.turnNode||workReceiptIds.length){
      const commitPayload={analysisState:prepared.state,turnNode:prepared.turnNode,historyCommit:historyCommit&&prepared.turnNode?{...historyCommit,completedAt:prepared.turnNode.committedAt}:null,workReceiptIds};
      if(callbacks.onCertifiedTurn)callbacks.onCertifiedTurn(commitPayload);`;
  text=replaceOnce(text,durableCommit,durableCommitNew,'atomically consume delivered receipts');
  text=replaceOnce(text,"      if(historyCommit){","      if(prepared.turnNode&&historyCommit){",'history only on cognitive delta');
  return text;
});

edit('src/core/scheduler.js', text=>replaceOnce(
  text,
  "        onCertifiedTurn:commit=>{if(!this.shuttingDown)this.repository.commitCertifiedTurn(taskId,commit);},",
  "        onCertifiedTurn:commit=>{if(!this.shuttingDown)this.repository.commitCertifiedTurn(taskId,commit);},\n        onWorkReceipt:receipt=>{if(this.shuttingDown){const error=new Error('WORK_RECEIPT_PERSISTENCE_UNAVAILABLE_DURING_SHUTDOWN');error.nonRetryable=true;throw error;}this.repository.commitWorkReceipt(taskId,receipt);},",
  'Scheduler Task Core receipt persistence',
));

// Fix selected-attachment scratch names without duplicating an existing extension.
edit('src/extensions/executors/codex/codex-executor.js', text=>replaceOnce(
  text,
  "      const target=resolve(inputDir,`${index+1}-${safe}${extname(attachment.name||attachment.path||'')}`);",
  "      const extension=extname(attachment.name||attachment.path||'');\n      const target=resolve(inputDir,`${index+1}-${safe}${extension&&safe.toLowerCase().endsWith(extension.toLowerCase())?'':extension}`);",
  'attachment scratch filename',
));

// Regress the authority classification, private projection, durable receipt recovery,
// and staged visual source behavior.
edit('tests/runtime-authority-boundary.test.js', text=>{
  text=replaceOnce(text,"import { GovernanceCompiler } from '../src/governance/governance-compiler.js';","import { GovernanceCompiler, inferTaskMode } from '../src/governance/governance-compiler.js';",'task mode test import');
  const insert=`
test('taskMode inference does not turn noun-like current implementation analysis into write authority',()=>{
  assert.equal(inferTaskMode({title:'架构审查',instruction:'分析当前实现并定位根因'}),'analysis');
  assert.equal(inferTaskMode({title:'功能开发',instruction:'请实现这个功能并修改代码'}),'execution');
});
`;
  const marker="test('Capability Contract compiles into one typed executionGrant for Root, Subagent and Validator',()=>{";
  text=replaceOnce(text,marker,insert+'\n'+marker,'task mode authority regression');
  return text;
});

edit('tests/validator-semantic-proof.test.js', text=>{
  const old="    assert.deepEqual(client.calls[0].inputItems,[{type:'localImage',path:cited}]);";
  const replacement=`    assert.equal(client.calls[0].inputItems.length,1);
    assert.equal(client.calls[0].inputItems[0].type,'localImage');
    assert.notEqual(client.calls[0].inputItems[0].path,cited,'Validator receives a TaskBoard-managed copy, not the shared attachment-store path');
    assert.match(client.calls[0].inputItems[0].path,/validator[\\\\/]inputs[\\\\/]/);
    assert.equal(client.calls[0].inputItems.some(item=>item.path===uncited),false);`;
  return replaceOnce(text,old,replacement,'Validator staged visual assertion');
});

edit('tests/repository.test.js', text=>{
  const append=`

test('completed Work Unit receipt is durable, semantically unique, and consumed atomically with the certified Root turn',()=>{
  const {repo,close}=makeRepo();
  try{
    const task=repo.createTask({title:'receipt',instruction:'analyze'});
    const receipt={id:'WU-1',signature:'sig-1',workUnit:{id:'WU-1',title:'scan',goal:'scan',expectedOutput:'result',stopCondition:'done',projectAccess:'read',networkAccess:false,skillId:null,dependsOn:[],inputRefs:['project:0']},result:{delegationId:'WU-1',result:'done',evidence:[],findings:[],discoveries:[],blocker:null,uncertainty:null},completed_at:'2026-08-13T00:00:00.000Z'};
    repo.commitWorkReceipt(task.id,receipt);
    repo.commitWorkReceipt(task.id,{...receipt,id:'WU-other'});
    let stored=repo.getTask(task.id).workReceipts;
    assert.equal(stored.length,1,'same semantic work is one durable receipt even if a new id is proposed');
    assert.equal(stored[0].consumed_at,null);
    repo.commitCertifiedTurn(task.id,{analysisState:{version:0,current:{resultMode:'analysis',evidence:[],claims:[],gaps:[],recommendations:[],steps:[]},turns:[]},workReceiptIds:['WU-1']});
    stored=repo.getTask(task.id).workReceipts;
    assert.ok(stored[0].consumed_at);
  }finally{close();}
});
`;
  return text+append;
});

console.log('goal authority durable receipt/task-mode patch applied');
