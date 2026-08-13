import { readFileSync, writeFileSync } from 'node:fs';
const path='src/core/scheduler.js';
let s=readFileSync(path,'utf8');
const marker="      if(outcome.kind==='needs_human'){";
const block=`      if(outcome.kind==='goal_satisfied'){
        if(!admitted){const error=new Error('EXECUTOR_START_NOT_REPORTED');error.nonRetryable=true;throw error;}
        this.ensureQuiescent(taskId);
        const proposal=outcome.proposal||{};
        const done=this.repository.transitionTask(taskId,TaskStatus.COMPLETED,{completionReason:CompletionReason.SUCCESS,finalResult:proposal.finalResult,lastStageResult:proposal.stageResult,clearCancel:true,executionState:null});
        this.setActivity(taskId,{state:'completed',summary:'任务已完成',detail:proposal.summary||'CompletionEvaluator 已确认 governed obligations 满足。',current:null});
        this.rootRuntime.cleanupTaskWorkspace?.(taskId);
        return done;
      }
`;
const i=s.indexOf(marker);if(i<0)throw new Error('PHASE4_SCHEDULER_GOAL_MARKER_NOT_FOUND');if(s.indexOf("outcome.kind==='goal_satisfied'")>=0)throw new Error('PHASE4_SCHEDULER_GOAL_HANDLER_ALREADY_EXISTS');s=s.slice(0,i)+block+s.slice(i);writeFileSync(path,s,'utf8');console.log('Phase 4 Scheduler goal_satisfied projection applied');
