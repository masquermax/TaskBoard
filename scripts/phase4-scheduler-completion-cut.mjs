import { readFileSync, writeFileSync } from 'node:fs';
const path='src/core/scheduler.js';
const source=readFileSync(path,'utf8');
const before=`      if(outcome.kind==='complete'){
        if(!admitted){const error=new Error('EXECUTOR_START_NOT_REPORTED');error.nonRetryable=true;throw error;}
        this.ensureQuiescent(taskId);
        const done=this.repository.transitionTask(taskId,TaskStatus.COMPLETED,{completionReason:CompletionReason.SUCCESS,finalResult:outcome.finalResult,lastStageResult:outcome.stageResult,clearCancel:true,executionState:null});
        this.setActivity(taskId,{state:'completed',summary:'任务已完成',detail:outcome.summary||'最终结果已经形成。',current:null});
        this.rootRuntime.cleanupTaskWorkspace?.(taskId);
        return done;
      }
`;
const first=source.indexOf(before);
if(first<0)throw new Error('PHASE4_SCHEDULER_COMPLETION_BLOCK_NOT_FOUND');
if(source.indexOf(before,first+before.length)>=0)throw new Error('PHASE4_SCHEDULER_COMPLETION_BLOCK_DUPLICATED');
writeFileSync(path,source.slice(0,first)+source.slice(first+before.length),'utf8');
console.log('Phase 4 Scheduler direct SUCCESS completion cut applied');
