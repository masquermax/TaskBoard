import { readFileSync, writeFileSync } from 'node:fs';

function replaceExact(source,before,after,label){
  if(source.includes(after))return source;
  const first=source.indexOf(before);
  if(first<0)throw new Error(`PHASE4_UI_ANCHOR_MISSING:${label}`);
  if(source.indexOf(before,first+before.length)>=0)throw new Error(`PHASE4_UI_ANCHOR_DUPLICATE:${label}`);
  return source.slice(0,first)+after+source.slice(first+before.length);
}

const jsPath='src/ui/app.js';
let js=readFileSync(jsPath,'utf8');

js=replaceExact(js,
"function displayTaskBadge(task){if(task.status==='COMPLETED'&&task.completion_reason==='CANCELLED')return'已取消';return statusCopy[task.status].badge;}",
"function completionPresentation(task){if(task?.status!=='COMPLETED')return{badge:statusCopy[task?.status]?.badge||'',resultTitle:'',tone:''};if(task.completion_reason==='SUCCESS')return{badge:'已完成',resultTitle:'最终结果',tone:'success'};if(task.completion_reason==='CANCELLED')return{badge:'已取消',resultTitle:'任务结果 · 已取消',tone:'cancelled'};return{badge:'已结束',resultTitle:'任务结果 · 完成原因未确认',tone:'unresolved'};}\nfunction displayTaskBadge(task){return completionPresentation(task).badge;}",
'completion-presentation');

js=replaceExact(js,
"function renderTasks(){$('result-count').textContent=`${state.tasks.length} 个结果`;$('empty-state').classList.toggle('hidden',state.tasks.length>0);$('task-list').innerHTML=state.tasks.map(task=>`<button class=\"task-card ${task.id===state.selectedTaskId?'is-selected':''}\" data-task-id=\"${task.id}\"><div class=\"task-card-top\"><div class=\"task-title-stack\">${task.status==='READY'?`<span class=\"ready-reason ${escapeHtml(task.ready_reason||'NEW')}\">${readyReasonCopy[task.ready_reason]||'需执行'}</span>`:''}<div class=\"task-title\">${task.locked?'🔒 ':''}${escapeHtml(task.title)}</div></div><span class=\"mini-badge ${task.status} ${task.completion_reason==='CANCELLED'?'cancelled':''}\">${displayTaskBadge(task)}</span></div><div class=\"task-snippet\">${escapeHtml(task.instruction)}</div><div class=\"task-card-bottom\"><span class=\"project-chip\">${escapeHtml(projectLabel(task))}${task.attachments?.length?` · 📎${task.attachments.length}`:''}</span>${taskCardTimes(task)}</div></button>`).join('');document.querySelectorAll('[data-task-id]').forEach(card=>card.addEventListener('click',()=>{state.selectedTaskId=card.dataset.taskId;state.runtime=null;state.historyOpen=false;renderTasks();renderDetail();refreshRuntime();}));}",
"function renderTasks(){$('result-count').textContent=`${state.tasks.length} 个结果`;$('empty-state').classList.toggle('hidden',state.tasks.length>0);$('task-list').innerHTML=state.tasks.map(task=>{const view=completionPresentation(task);return`<button class=\"task-card ${task.id===state.selectedTaskId?'is-selected':''}\" data-task-id=\"${task.id}\"><div class=\"task-card-top\"><div class=\"task-title-stack\">${task.status==='READY'?`<span class=\"ready-reason ${escapeHtml(task.ready_reason||'NEW')}\">${readyReasonCopy[task.ready_reason]||'需执行'}</span>`:''}<div class=\"task-title\">${task.locked?'🔒 ':''}${escapeHtml(task.title)}</div></div><span class=\"mini-badge ${task.status} ${view.tone}\">${view.badge}</span></div><div class=\"task-snippet\">${escapeHtml(task.instruction)}</div><div class=\"task-card-bottom\"><span class=\"project-chip\">${escapeHtml(projectLabel(task))}${task.attachments?.length?` · 📎${task.attachments.length}`:''}</span>${taskCardTimes(task)}</div></button>`;}).join('');document.querySelectorAll('[data-task-id]').forEach(card=>card.addEventListener('click',()=>{state.selectedTaskId=card.dataset.taskId;state.runtime=null;state.historyOpen=false;renderTasks();renderDetail();refreshRuntime();}));}",
'render-task-completion-tone');

js=replaceExact(js,
"function renderDetail(){const task=selectedTask();$('detail-empty').classList.toggle('hidden',Boolean(task));$('detail-content').classList.toggle('hidden',!task);if(!task)return;$('detail-id').textContent=task.id;$('detail-title').textContent=task.title;$('detail-status').textContent=displayTaskBadge(task);$('detail-status').className=`phase-badge ${task.status} ${task.completion_reason==='CANCELLED'?'cancelled':''}`;$('detail-phase-time').textContent=`${displayTaskBadge(task)} · ${formatPhaseTime(task.status_entered_at)}`;$('detail-instruction').textContent=task.instruction;",
"function renderDetail(){const task=selectedTask();$('detail-empty').classList.toggle('hidden',Boolean(task));$('detail-content').classList.toggle('hidden',!task);if(!task)return;const view=completionPresentation(task);$('detail-id').textContent=task.id;$('detail-title').textContent=task.title;$('detail-status').textContent=view.badge;$('detail-status').className=`phase-badge ${task.status} ${view.tone}`;$('detail-phase-time').textContent=`${view.badge} · ${formatPhaseTime(task.status_entered_at)}`;$('detail-instruction').textContent=task.instruction;",
'render-detail-completion-tone');

js=replaceExact(js,
"$('result-card').classList.toggle('hidden',task.status!=='COMPLETED');$('result-title').textContent=task.completion_reason==='CANCELLED'?'任务结果 · 已取消':'最终结果';$('final-result').textContent=task.final_result||'';renderTaskActions(task);renderRuntime();}",
"$('result-card').classList.toggle('hidden',task.status!=='COMPLETED');$('result-title').textContent=view.resultTitle;$('final-result').textContent=task.final_result||'';renderTaskActions(task);renderRuntime();}",
'result-title-projection');

js=replaceExact(js,
"function renderRuntime(){const task=selectedTask();if(!task)return;const runtime=state.runtime&&state.runtime.taskId===task.id?state.runtime:null;",
"function renderRuntime(){const task=selectedTask();if(!task)return;const completionView=completionPresentation(task);const runtime=state.runtime&&state.runtime.taskId===task.id?state.runtime:null;",
'runtime-completion-view');

js=replaceExact(js,
"{taskId:task.id,state:'completed',summary:task.completion_reason==='CANCELLED'?'任务已取消':'任务已完成',detail:'',updatedAt:task.status_entered_at,current:null,history:[]}",
"{taskId:task.id,state:'completed',summary:completionView.tone==='success'?'任务已完成':completionView.tone==='cancelled'?'任务已取消':'任务已结束，完成原因未确认',detail:'',updatedAt:task.status_entered_at,current:null,history:[]}",
'runtime-completed-summary');

for(const forbidden of ['taskContract','task_contract','goalState','goal_state','certifiedAssessments','certified_assessments','workReceipts','work_receipts']){
  if(js.toLowerCase().includes(forbidden.toLowerCase()))throw new Error(`PHASE4_UI_GOVERNED_INPUT_LEAK:${forbidden}`);
}
writeFileSync(jsPath,js,'utf8');

const cssPath='src/ui/app.css';
let css=readFileSync(cssPath,'utf8');
const neutral='.mini-badge.COMPLETED.unresolved,.phase-badge.COMPLETED.unresolved{background:#f1f1f3;color:#62666c}';
if(!css.includes(neutral)){
  const anchor='.mini-badge.cancelled,.phase-badge.cancelled{background:#f1f1f3;color:#62666c}';
  const index=css.indexOf(anchor);
  if(index<0)throw new Error('PHASE4_UI_CSS_ANCHOR_MISSING:cancelled');
  css=css.slice(0,index+anchor.length)+'\n'+neutral+css.slice(index+anchor.length);
}
writeFileSync(cssPath,css,'utf8');
console.log('Phase 4 UI lifecycle completion projection applied');
