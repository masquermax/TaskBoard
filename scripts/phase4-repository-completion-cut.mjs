import { readFileSync, writeFileSync } from 'node:fs';
const path='src/core/json-repository.js';
let source=readFileSync(path,'utf8');
const replacements=[
  ["        if (task.completion_reason === undefined) task.completion_reason = task.status === TaskStatus.COMPLETED ? CompletionReason.SUCCESS : null;","        if (task.completion_reason === undefined) task.completion_reason = null;"],
  ["completion_reason:row.completion_reason||(row.status===TaskStatus.COMPLETED?CompletionReason.SUCCESS:null)","completion_reason:row.completion_reason??null"],
  ["const task=this.state.tasks.find(t=>t.id===id);if(!task)throw new Error('TASK_NOT_FOUND');const now=this.now();","const task=this.state.tasks.find(t=>t.id===id);if(!task)throw new Error('TASK_NOT_FOUND');if(nextStatus===TaskStatus.COMPLETED&&completionReason==null)throw new Error('TASK_COMPLETION_REASON_REQUIRED');const now=this.now();"],
  ["task.completion_reason=nextStatus===TaskStatus.COMPLETED?(completionReason||CompletionReason.SUCCESS):null;","task.completion_reason=nextStatus===TaskStatus.COMPLETED?completionReason:null;"],
];
for(const [before,after] of replacements){const first=source.indexOf(before);if(first<0)throw new Error(`PHASE4_REPOSITORY_PATTERN_NOT_FOUND: ${before.slice(0,80)}`);if(source.indexOf(before,first+before.length)>=0)throw new Error(`PHASE4_REPOSITORY_PATTERN_DUPLICATED: ${before.slice(0,80)}`);source=source.slice(0,first)+after+source.slice(first+before.length);}
writeFileSync(path,source,'utf8');
console.log('Phase 4 Repository completion inference cut applied');
