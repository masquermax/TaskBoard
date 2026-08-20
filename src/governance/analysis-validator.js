// Compatibility bridge only. Analysis presentation is not Validator authority.
// New code imports analysis-presentation.js directly; this file can disappear once
// the remaining Runtime import is migrated.
export {
  pendingAnalysisItems,
  hasGovernedCandidateDelta,
  canonicalAnalysisSummary,
  renderAnalysisResult,
} from './analysis-presentation.js';
