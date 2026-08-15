const ACCESS_RANK=Object.freeze({none:0,read:1,write:2});

export function normalizeProjectAccess(value){
  const normalized=String(value||'none').trim().toLowerCase();
  return normalized in ACCESS_RANK?normalized:'none';
}

// A Work Unit must ask only for the minimum capability its authored semantics
// actually require. Keeping a second "requiredCapabilities" field creates two
// competing descriptions of the same work and lets them drift apart.
export function requiredWorkCapabilities(work={}){
  return {
    projectAccess:normalizeProjectAccess(work?.projectAccess),
    networkAccess:work?.networkAccess===true,
  };
}

// Compatibility name for callers/tests that still speak in request terms.
// Request and required semantics are intentionally the same current contract.
export function requestedWorkCapabilities(work={}){
  return requiredWorkCapabilities(work);
}

export function validateWorkCapabilityContract(work={}){
  const required=requiredWorkCapabilities(work);
  return {requested:{...required},required,issues:[]};
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
  const required=requiredWorkCapabilities(work);
  return required.projectAccess==='write'||required.networkAccess===true;
}
