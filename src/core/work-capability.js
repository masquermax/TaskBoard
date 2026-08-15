const ACCESS_RANK=Object.freeze({none:0,read:1,write:2});

export function normalizeProjectAccess(value){
  const normalized=String(value||'none').trim().toLowerCase();
  return normalized in ACCESS_RANK?normalized:'none';
}

export function requestedWorkCapabilities(work={}){
  return {
    projectAccess:normalizeProjectAccess(work?.projectAccess),
    networkAccess:work?.networkAccess===true,
  };
}

export function requiredWorkCapabilities(work={}){
  const required=work?.requiredCapabilities&&typeof work.requiredCapabilities==='object'?work.requiredCapabilities:null;
  const requested=requestedWorkCapabilities(work);
  return {
    // Fallback preserves pre-D-019 durable/test Work Units. New Codex-authored
    // Work Units carry requiredCapabilities explicitly in the output schema.
    projectAccess:normalizeProjectAccess(required?.projectAccess??requested.projectAccess),
    networkAccess:required?.networkAccess==null?requested.networkAccess:required.networkAccess===true,
  };
}

export function validateWorkCapabilityContract(work={}){
  const requested=requestedWorkCapabilities(work);
  const required=requiredWorkCapabilities(work);
  const issues=[];
  if(ACCESS_RANK[required.projectAccess]>ACCESS_RANK[requested.projectAccess]){
    issues.push(`required projectAccess=${required.projectAccess} exceeds requested projectAccess=${requested.projectAccess}`);
  }
  if(required.networkAccess&&!requested.networkAccess){
    issues.push('required networkAccess=true exceeds requested networkAccess=false');
  }
  return {requested,required,issues};
}

export function capabilitiesSatisfy(requiredValue={},actualValue={}){
  const required={
    projectAccess:normalizeProjectAccess(requiredValue?.projectAccess),
    networkAccess:requiredValue?.networkAccess===true,
  };
  const actual={
    projectAccess:normalizeProjectAccess(actualValue?.projectAccess),
    networkAccess:actualValue?.networkAccess===true,
  };
  return ACCESS_RANK[actual.projectAccess]>=ACCESS_RANK[required.projectAccess]
    &&(!required.networkAccess||actual.networkAccess);
}

export function workMayMutate(work={}){
  const actual=requestedWorkCapabilities(work);
  return actual.projectAccess==='write'||actual.networkAccess===true;
}
