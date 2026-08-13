import { readFileSync, writeFileSync } from 'node:fs';

const path='src/core/root-runtime.js';
const source=readFileSync(path,'utf8');
const before=`      if (decision.kind === 'complete') {
        const finalView = decision.resultMode === 'analysis' ? decisionFromCertifiedState(session.analysisState,decision) : null;
        const finalResult = finalView ? renderAnalysisResult(finalView) : composeExecutionResult(decision);
        const finalSummary = finalView ? canonicalAnalysisSummary(finalView) : decision.summary;
        const stageResult = session.lastCommittedStageResult || decision.stageResult || null;
        this.discardSession(task.id);
        return { kind:'complete', finalResult, summary:finalSummary, stageResult, quiescent:true };
      }`;
const after=`      if (decision.kind === 'complete') {
        const finalView = decision.resultMode === 'analysis' ? decisionFromCertifiedState(session.analysisState,decision) : null;
        const finalResult = finalView ? renderAnalysisResult(finalView) : composeExecutionResult(decision);
        const finalSummary = finalView ? canonicalAnalysisSummary(finalView) : decision.summary;
        const stageResult = session.lastCommittedStageResult || decision.stageResult || null;
        this.discardSession(task.id);
        return { kind:'completion_proposed', proposal:{ finalResult, summary:finalSummary, stageResult }, quiescent:true };
      }`;
const first=source.indexOf(before);
if(first<0)throw new Error('PHASE4_ROOT_COMPLETION_BLOCK_NOT_FOUND');
if(source.indexOf(before,first+before.length)>=0)throw new Error('PHASE4_ROOT_COMPLETION_BLOCK_DUPLICATED');
writeFileSync(path,source.slice(0,first)+after+source.slice(first+before.length),'utf8');
console.log('Phase 4 Root completion proposal cut applied');
