const ACCESS_RANK=Object.freeze({none:0,read:1,write:2});

export function normalizeProjectAccess(value){
  const normalized=String(value||'none').trim().toLowerCase();
  return normalized in ACCESS_RANK?normalized:'none';
}

// The Work Unit request is the minimum capability its authored semantics require.
// Keep one representation only; Governance may deny it but must not silently
// redefine the Work by weakening the realized capability.
export function requiredWorkCapabilities(work={}){
  return {
    projectAccess:normalizeProjectAccess(work?.projectAccess),
    networkAccess:work?.networkAccess===true,
  };
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
