function freeze(value){
  if(!value||typeof value!=='object'||Object.isFrozen(value))return value;
  Object.freeze(value);for(const item of Object.values(value))freeze(item);return value;
}

const CONTRACTS=freeze({
  root:{id:'ROOT',role:'root',projectAccess:'none',networkAccess:false,sourceAccess:'none',environmentAccess:'none'},
  subagent:{id:'SUBAGENT',role:'subagent',projectAccess:'write',networkAccess:true,sourceAccess:'selected',environmentAccess:'default'},
  validator:{id:'VALIDATOR',role:'validator',projectAccess:'none',networkAccess:false,sourceAccess:'proof-only',environmentAccess:'none'},
});

export function roleCapabilityContract(role){return CONTRACTS[String(role||'').toLowerCase()]||null;}
export function roleCapabilityContracts(){return CONTRACTS;}
export function renderRoleCapabilityContract(contract){
  if(!contract)return '';
  return [
    `ROLE CAPABILITY CONTRACT — ${contract.id}`,
    `Project access ceiling: ${contract.projectAccess}.`,
    `Network access ceiling: ${contract.networkAccess===true?'enabled':'disabled'}.`,
    `Source context: ${contract.sourceAccess}.`,
    `Environment context: ${contract.environmentAccess}.`,
    'These are static role ceilings. GovernanceCompiler may only narrow them using governed Task facts, Work Unit requests, selected scope and policy.',
  ].join('\n');
}
