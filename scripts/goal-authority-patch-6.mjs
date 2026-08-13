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

// Consuming a durable execution receipt is not itself a cognition Turn. Keep the
// APIs separate while retaining atomic receipt consumption when a real certified
// Turn is committed at the same boundary.
edit('src/core/json-repository.js', text=>{
  const anchor="  commitCertifiedTurn(taskId,{analysisState,historyCommit=null,workReceiptIds=[]}){const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');this.store.transaction(()=>{t.analysis_state=analysisState==null?null:clone(analysisState);const consumed=new Set((Array.isArray(workReceiptIds)?workReceiptIds:[]).map(value=>String(value||'').trim()).filter(Boolean));if(consumed.size){for(const receipt of t.work_receipts||[])if(consumed.has(String(receipt?.id||''))&&!receipt.consumed_at)receipt.consumed_at=this.now();}if(historyCommit?.title&&historyCommit?.detail){this.state.progressHistory.push({id:++this.state.counters.progress,task_id:taskId,title:historyCommit.title,detail:historyCommit.detail,completed_at:historyCommit.completedAt||this.now()});t.last_stage_result=historyCommit.detail||null;}});return this.getTask(taskId);}";
  const replacement=`  consumeWorkReceipts(taskId,workReceiptIds=[]){
    const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');
    const consumed=new Set((Array.isArray(workReceiptIds)?workReceiptIds:[]).map(value=>String(value||'').trim()).filter(Boolean));
    if(!consumed.size)return this.getTask(taskId);
    this.store.transaction(()=>{for(const receipt of t.work_receipts||[])if(consumed.has(String(receipt?.id||''))&&!receipt.consumed_at)receipt.consumed_at=this.now();});
    return this.getTask(taskId);
  }
  commitCertifiedTurn(taskId,{analysisState,historyCommit=null,workReceiptIds=[]}){const t=this.state.tasks.find(x=>x.id===taskId);if(!t)throw new Error('TASK_NOT_FOUND');this.store.transaction(()=>{t.analysis_state=analysisState==null?null:clone(analysisState);const consumed=new Set((Array.isArray(workReceiptIds)?workReceiptIds:[]).map(value=>String(value||'').trim()).filter(Boolean));if(consumed.size){for(const receipt of t.work_receipts||[])if(consumed.has(String(receipt?.id||''))&&!receipt.consumed_at)receipt.consumed_at=this.now();}if(historyCommit?.title&&historyCommit?.detail){this.state.progressHistory.push({id:++this.state.counters.progress,task_id:taskId,title:historyCommit.title,detail:historyCommit.detail,completed_at:historyCommit.completedAt||this.now()});t.last_stage_result=historyCommit.detail||null;}});return this.getTask(taskId);}`;
  return replaceOnce(text,anchor,replacement,'separate receipt consumption API');
});

edit('src/core/root-runtime.js', text=>{
  text=replaceOnce(text,
    "  async execute(task, { humanGatewayHistory = [], onProgress = null, onStageCompleted = null, onStageResult = null, onProgressCommit = null, onCertifiedTurn = null, onWorkReceipt = null, onExecutionStarted = null } = {}) {",
    "  async execute(task, { humanGatewayHistory = [], onProgress = null, onStageCompleted = null, onStageResult = null, onProgressCommit = null, onCertifiedTurn = null, onWorkReceipt = null, onWorkReceiptsConsumed = null, onExecutionStarted = null } = {}) {",
    'receipt consumed callback API');
  text=replaceOnce(text,
    "    const callbacks = { onProgress, onStageCompleted, onStageResult, onProgressCommit, onCertifiedTurn, onWorkReceipt, onExecutionStarted };",
    "    const callbacks = { onProgress, onStageCompleted, onStageResult, onProgressCommit, onCertifiedTurn, onWorkReceipt, onWorkReceiptsConsumed, onExecutionStarted };",
    'receipt consumed callback wiring');

  const old=`    const historyCommit=deriveHistoryFromTurn(prepared.turnNode);
    const workReceiptIds=(Array.isArray(rootInputs)?rootInputs:[]).map(item=>String(item?.delegationId||item?.workUnit?.id||'').trim()).filter(Boolean);
    if(prepared.turnNode||workReceiptIds.length){
      const commitPayload={analysisState:prepared.state,turnNode:prepared.turnNode,historyCommit:historyCommit&&prepared.turnNode?{...historyCommit,completedAt:prepared.turnNode.committedAt}:null,workReceiptIds};
      if(callbacks.onCertifiedTurn)callbacks.onCertifiedTurn(commitPayload);
      else if(historyCommit)this.commitProgress(session,callbacks,[historyCommit]);
      session.analysisState=prepared.state;
      session.certifiedContext=prepared.state.current;
      session.certifiedKnowledgeKeys=knowledgeKeysFromState(prepared.state);
      if(prepared.turnNode&&historyCommit){`;
  const replacement=`    const historyCommit=deriveHistoryFromTurn(prepared.turnNode);
    const workReceiptIds=(Array.isArray(rootInputs)?rootInputs:[]).map(item=>String(item?.delegationId||item?.workUnit?.id||'').trim()).filter(Boolean);
    if(prepared.turnNode){
      const commitPayload={analysisState:prepared.state,turnNode:prepared.turnNode,historyCommit:historyCommit?{...historyCommit,completedAt:prepared.turnNode.committedAt}:null,workReceiptIds};
      if(callbacks.onCertifiedTurn)callbacks.onCertifiedTurn(commitPayload);
      else if(historyCommit)this.commitProgress(session,callbacks,[historyCommit]);
      session.analysisState=prepared.state;
      session.certifiedContext=prepared.state.current;
      session.certifiedKnowledgeKeys=knowledgeKeysFromState(prepared.state);
      if(historyCommit){`;
  text=replaceOnce(text,old,replacement,'do not manufacture certified turn for receipt-only consumption');

  const close=`      }
    }
    const blockingGap=prepared.current.gaps?.find?.(gap=>gap?.blocking===true);`;
  const closeNew=`      }
    } else if(workReceiptIds.length) {
      callbacks.onWorkReceiptsConsumed?.(workReceiptIds);
    }
    const blockingGap=prepared.current.gaps?.find?.(gap=>gap?.blocking===true);`;
  return replaceOnce(text,close,closeNew,'receipt-only consumption path');
});

edit('src/core/scheduler.js', text=>replaceOnce(
  text,
  "        onWorkReceipt:receipt=>{if(this.shuttingDown){const error=new Error('WORK_RECEIPT_PERSISTENCE_UNAVAILABLE_DURING_SHUTDOWN');error.nonRetryable=true;throw error;}this.repository.commitWorkReceipt(taskId,receipt);},",
  "        onWorkReceipt:receipt=>{if(this.shuttingDown){const error=new Error('WORK_RECEIPT_PERSISTENCE_UNAVAILABLE_DURING_SHUTDOWN');error.nonRetryable=true;throw error;}this.repository.commitWorkReceipt(taskId,receipt);},\n        onWorkReceiptsConsumed:ids=>{if(!this.shuttingDown)this.repository.consumeWorkReceipts(taskId,ids);},",
  'Scheduler receipt consumption wiring'));

// Public Task objects intentionally hide local attachment paths; persistence tests
// inspect the Repository-owned internal task when they need to verify the file.
edit('tests/task-service.test.js', text=>{
  const old=`    assert.equal(task.attachments.length, 1);
    assert.equal(task.attachments[0].name, '需求说明.txt');
    assert.ok(existsSync(task.attachments[0].path));
    assert.equal(readFileSync(task.attachments[0].path, 'utf8'), '附件里的需求内容');
    assert.equal(service.listProjects().length, 0);`;
  const replacement=`    assert.equal(task.attachments.length, 1);
    assert.equal(task.attachments[0].name, '需求说明.txt');
    assert.equal('path' in task.attachments[0], false, 'public Task attachment metadata must not expose a local filesystem path');
    const internalTask=repo.getTask(task.id);
    assert.ok(existsSync(internalTask.attachments[0].path));
    assert.equal(readFileSync(internalTask.attachments[0].path, 'utf8'), '附件里的需求内容');
    assert.equal(service.listProjects().length, 0);`;
  return replaceOnce(text,old,replacement,'attachment public/internal boundary test');
});

console.log('goal authority receipt-consumption/public-attachment cleanup applied');
