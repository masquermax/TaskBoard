function freeze(value){if(!value||typeof value!=='object'||Object.isFrozen(value))return value;Object.freeze(value);for(const item of Object.values(value))freeze(item);return value;}

const CONTRACTS=freeze({
  root:{id:'ROOT',role:'root',projectAccess:'none',networkAccess:false,sourceAccess:'none',environmentAccess:'none'},
  subagent:{id:'SUBAGENT',role:'subagent',projectAccess:'write',networkAccess:true,sourceAccess:'selected',environmentAccess:'default'},
});

export function roleCapabilityContract(role){return CONTRACTS[String(role||'').toLowerCase()]||null;}
export function roleCapabilityContracts(){return CONTRACTS;}
