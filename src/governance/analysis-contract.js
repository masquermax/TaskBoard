export const EvidenceStrength = Object.freeze({ DIRECT:'direct', INDIRECT:'indirect' });
export const EvidenceKind = Object.freeze({ FACT:'fact', PROBLEM:'problem', REQUIREMENT:'requirement' });
export const EvidenceSourceType = Object.freeze({ ATTACHMENT_TEXT:'attachment_text', ATTACHMENT_VISUAL:'attachment_visual', PROJECT_FILE:'project_file', PROJECT_SEARCH:'project_search', RUNTIME:'runtime', REFERENCE:'reference', HUMAN:'human' });
export const EvidenceCoverage = Object.freeze({ SOURCE:'source', COMPONENT:'component', PROJECT:'project', SYSTEM:'system', CROSS_SYSTEM:'cross_system' });
export const ClaimLevel = Object.freeze({ CONFIRMED:'confirmed', SUPPORTED:'supported' });
export const ClaimScope = Object.freeze({ GENERAL:'general', SINGLE_SYSTEM:'single_system', CROSS_SYSTEM:'cross_system' });
export const GapKind = Object.freeze({ MISSING_FACT:'missing_fact', BUSINESS_DECISION:'business_decision', RISK:'risk' });

export const evidenceSchema = {
  type:'object',
  properties:{
    id:{type:'string'},
    strength:{type:'string',enum:Object.values(EvidenceStrength)},
    kind:{type:'string',enum:Object.values(EvidenceKind)},
    sourceType:{type:'string',enum:Object.values(EvidenceSourceType)},
    coverage:{type:'string',enum:Object.values(EvidenceCoverage)},
    statement:{type:'string'},
    basis:{type:'string'},
    locator:{type:'string'},
    observation:{type:'string'},
  },
  required:['id','strength','kind','sourceType','coverage','statement','basis','locator','observation'],
  additionalProperties:false,
};

export const hopSchema = {
  type:'object',
  properties:{
    from:{type:'string'},
    to:{type:'string'},
    evidenceIds:{type:'array',items:{type:'string'},maxItems:12},
  },
  required:['from','to','evidenceIds'],
  additionalProperties:false,
};

export const claimSchema = {
  type:'object',
  properties:{
    id:{type:'string'},
    statement:{type:'string'},
    level:{type:'string',enum:Object.values(ClaimLevel)},
    evidenceIds:{type:'array',items:{type:'string'},maxItems:20},
    scope:{type:'string',enum:Object.values(ClaimScope)},
    coverage:{type:'string',enum:Object.values(EvidenceCoverage)},
    hops:{type:'array',items:hopSchema,maxItems:12},
  },
  required:['id','statement','level','evidenceIds','scope','coverage','hops'],
  additionalProperties:false,
};

export const gapSchema = {
  type:'object',
  properties:{
    id:{type:'string'},
    question:{type:'string'},
    reason:{type:'string'},
    kind:{type:'string',enum:Object.values(GapKind)},
    blocking:{type:'boolean'},
    evidenceIds:{type:'array',items:{type:'string'},maxItems:12},
  },
  required:['id','question','reason','kind','blocking','evidenceIds'],
  additionalProperties:false,
};


export const gapResolutionSchema = {
  type:'object',
  properties:{
    gapId:{type:'string'},
    reason:{type:'string'},
    evidenceIds:{type:'array',items:{type:'string'},minItems:1,maxItems:12},
  },
  required:['gapId','reason','evidenceIds'],
  additionalProperties:false,
};

export const recommendationSchema = {
  type:'object',
  properties:{
    id:{type:'string'},
    statement:{type:'string'},
    rationale:{type:'string'},
    evidenceIds:{type:'array',items:{type:'string'},maxItems:20},
    gapIds:{type:'array',items:{type:'string'},maxItems:20},
  },
  required:['id','statement','rationale','evidenceIds','gapIds'],
  additionalProperties:false,
};

export const stepSchema = {
  type:'object',
  properties:{
    order:{type:'integer'},
    text:{type:'string'},
    kind:{type:'string',enum:['confirmed']},
    sourceIds:{type:'array',items:{type:'string'},minItems:1,maxItems:8},
  },
  required:['order','text','kind','sourceIds'],
  additionalProperties:false,
};

export const analysisFieldsSchema = {
  resultMode:{type:'string',enum:['analysis','execution']},
  evidence:{type:'array',items:evidenceSchema,maxItems:60},
  claims:{type:'array',items:claimSchema,maxItems:50},
  gaps:{type:'array',items:gapSchema,maxItems:40},
  recommendations:{type:'array',items:recommendationSchema,maxItems:30},
  steps:{type:'array',items:stepSchema,maxItems:30},
};

export function normalizeAnalysisFields(value = {}) {
  const resultMode = value?.resultMode === 'analysis' ? 'analysis' : 'execution';
  return {
    resultMode,
    evidence:Array.isArray(value?.evidence) ? value.evidence : [],
    claims:Array.isArray(value?.claims) ? value.claims : [],
    gaps:Array.isArray(value?.gaps) ? value.gaps : [],
    recommendations:Array.isArray(value?.recommendations) ? value.recommendations : [],
    steps:Array.isArray(value?.steps) ? value.steps : [],
  };
}
